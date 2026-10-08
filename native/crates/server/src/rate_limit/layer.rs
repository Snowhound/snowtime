//! Rule-configured per-address, per-path Tower layers. The caller owns route policy and
//! refusal formatting; all groups share the same client-address resolver.
use axum::{body::Body, http::Request, response::Response};
use governor::middleware::NoOpMiddleware;
use std::{
    future::Future,
    net::IpAddr,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};
use tower::{Layer, Service, ServiceExt};
use tower_governor::{
    GovernorError, GovernorLayer, governor::GovernorConfigBuilder, key_extractor::KeyExtractor,
};

#[derive(Clone)]
pub struct IpPath {
    pub trusted_header: Option<String>,
}
impl KeyExtractor for IpPath {
    type Key = (Option<IpAddr>, String);
    fn extract<T>(&self, request: &Request<T>) -> Result<Self::Key, GovernorError> {
        Ok((
            crate::client_ip::resolve(
                request.headers(),
                request.extensions(),
                self.trusted_header.as_deref(),
            ),
            path(request.uri().path()).to_owned(),
        ))
    }
}
fn path(path: &str) -> &str {
    path.trim_end_matches('/')
}

#[derive(Clone, Copy)]
pub enum Pattern {
    Exact(&'static str),
    Prefix(&'static str),
}
impl Pattern {
    fn matches(self, path: &str) -> bool {
        match self {
            Self::Exact(value) => path == value,
            Self::Prefix(value) => path.starts_with(value),
        }
    }
}
#[derive(Clone)]
pub struct Rule {
    pub paths: Vec<Pattern>,
    pub window: Duration,
    pub max: u32,
}
impl Rule {
    pub fn period(&self) -> Option<Duration> {
        self.window.checked_div(self.max).filter(|p| !p.is_zero())
    }
}

type GroupLayer = GovernorLayer<IpPath, NoOpMiddleware, Body>;
#[derive(Clone)]
struct Group {
    paths: Vec<Pattern>,
    layer: GroupLayer,
}
#[derive(Clone)]
pub struct RuleLayer {
    groups: Arc<Vec<Group>>,
}
impl RuleLayer {
    /// First matching group wins. The key also contains the concrete path, so paths in a
    /// group don't spend each other's quotas. Cleanup ends when every layer is dropped.
    pub fn new(
        rules: Vec<Rule>,
        trusted_header: Option<String>,
        refusal: fn(GovernorError) -> Response,
    ) -> Result<Self, &'static str> {
        let mut groups = Vec::new();
        for rule in rules {
            let config = GovernorConfigBuilder::default()
                .period(
                    rule.period()
                        .ok_or("rate limits need a positive window and max")?,
                )
                .burst_size(rule.max)
                .key_extractor(IpPath {
                    trusted_header: trusted_header.clone(),
                })
                .finish()
                .ok_or("invalid rate limit quota")?;
            let limiter = Arc::downgrade(config.limiter());
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    let Some(limiter) = limiter.upgrade() else {
                        break;
                    };
                    limiter.retain_recent();
                }
            });
            groups.push(Group {
                paths: rule.paths,
                layer: GovernorLayer::new(config).error_handler(refusal),
            });
        }
        Ok(Self {
            groups: Arc::new(groups),
        })
    }
}
#[derive(Clone)]
pub struct RuleService<S> {
    inner: S,
    groups: Arc<Vec<Group>>,
}
impl<S> Layer<S> for RuleLayer {
    type Service = RuleService<S>;
    fn layer(&self, inner: S) -> Self::Service {
        RuleService {
            inner,
            groups: self.groups.clone(),
        }
    }
}
impl<S> Service<Request<Body>> for RuleService<S>
where
    S: Service<Request<Body>, Response = Response> + Clone + Send + 'static,
    S::Future: Send,
    S::Error: Send,
{
    type Response = Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Response, S::Error>> + Send>>;
    fn poll_ready(&mut self, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }
    fn call(&mut self, request: Request<Body>) -> Self::Future {
        let group = self.groups.iter().find(|g| {
            g.paths
                .iter()
                .any(|p| p.matches(path(request.uri().path())))
        });
        let inner = self.inner.clone();
        match group {
            Some(group) => Box::pin(group.layer.layer(inner).oneshot(request)),
            None => Box::pin(inner.oneshot(request)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::ConnectInfo;
    use governor::{Quota, RateLimiter, clock::FakeRelativeClock};
    use std::num::NonZeroU32;

    #[test]
    fn keys_separate_paths_and_addresses_but_ignore_queries_and_spoofed_headers() {
        let extractor = IpPath {
            trusted_header: None,
        };
        let mut a = Request::builder()
            .uri("/auth/sign-in/?a=1")
            .header("x-forwarded-for", "203.0.113.1")
            .body(())
            .unwrap();
        a.extensions_mut().insert(ConnectInfo(
            "192.0.2.1:1000".parse::<std::net::SocketAddr>().unwrap(),
        ));
        let key = extractor.extract(&a).unwrap();
        assert_eq!(
            key,
            (Some("192.0.2.1".parse().unwrap()), "/auth/sign-in".into())
        );
        let mut b = Request::builder().uri("/auth/sign-out").body(()).unwrap();
        b.extensions_mut().insert(ConnectInfo(
            "192.0.2.1:2000".parse::<std::net::SocketAddr>().unwrap(),
        ));
        assert_ne!(key, extractor.extract(&b).unwrap());
        b.extensions_mut().insert(ConnectInfo(
            "192.0.2.2:2000".parse::<std::net::SocketAddr>().unwrap(),
        ));
        assert_ne!(key.0, extractor.extract(&b).unwrap().0);
        assert_eq!(extractor.extract(&Request::new(())).unwrap().0, None);
    }
    #[test]
    fn gcra_allows_the_burst_and_refills_each_window_divided_by_max() {
        for (window, max) in [(10, 100), (10, 3), (60, 3), (3600, 10), (60, 30)] {
            let rule = Rule {
                paths: vec![],
                window: Duration::from_secs(window),
                max,
            };
            let period = rule.period().unwrap();
            let clock = FakeRelativeClock::default();
            let quota = Quota::with_period(period)
                .unwrap()
                .allow_burst(NonZeroU32::new(max).unwrap());
            let limiter = RateLimiter::<_, _, _, NoOpMiddleware<governor::nanos::Nanos>>::new(
                quota,
                governor::state::keyed::DefaultKeyedStateStore::<&str>::default(),
                clock.clone(),
            );
            for _ in 0..max {
                assert!(limiter.check_key(&"a").is_ok());
            }
            assert!(limiter.check_key(&"a").is_err());
            assert!(limiter.check_key(&"b").is_ok());
            clock.advance(period - Duration::from_nanos(1));
            assert!(limiter.check_key(&"a").is_err());
            clock.advance(Duration::from_nanos(1));
            assert!(limiter.check_key(&"a").is_ok());
            assert!(limiter.check_key(&"a").is_err());
            clock.advance(rule.window + period + Duration::from_nanos(1));
            limiter.retain_recent();
            assert_eq!(limiter.len(), 0);
        }
        assert!(
            Rule {
                paths: vec![],
                window: Duration::ZERO,
                max: 3
            }
            .period()
            .is_none()
        );
        assert!(
            Rule {
                paths: vec![],
                window: Duration::from_secs(1),
                max: 0
            }
            .period()
            .is_none()
        );
    }
    #[tokio::test]
    async fn the_configured_layer_selects_one_group_and_formats_the_refusal() {
        fn refusal(_: GovernorError) -> Response {
            let mut response = Response::new(Body::empty());
            *response.status_mut() = axum::http::StatusCode::TOO_MANY_REQUESTS;
            response
        }
        let layer = RuleLayer::new(
            vec![
                Rule {
                    paths: vec![Pattern::Exact("/auth/special")],
                    window: Duration::from_secs(60),
                    max: 1,
                },
                Rule {
                    paths: vec![Pattern::Prefix("/auth/")],
                    window: Duration::from_secs(60),
                    max: 2,
                },
            ],
            None,
            refusal,
        )
        .unwrap();
        let service = layer.layer(tower::service_fn(|_: Request<Body>| async {
            Ok::<_, std::convert::Infallible>(Response::new(Body::empty()))
        }));
        for (path, status) in [
            ("/auth/special", 200),
            ("/auth/special", 429),
            ("/auth/other", 200),
            ("/auth/other", 200),
            ("/auth/other", 429),
            ("/api", 200),
            ("/api", 200),
        ] {
            assert_eq!(
                service
                    .clone()
                    .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                    .await
                    .unwrap()
                    .status()
                    .as_u16(),
                status
            );
        }
    }
}
