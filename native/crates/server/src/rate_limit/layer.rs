//! Rule-configured per-address, per-route Tower layers. The caller owns route policy and
//! refusal formatting; all groups share the same client-address resolver.
use axum::{body::Body, extract::MatchedPath, http::Request, response::Response};
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

// The path a request's quota counts under, which `RuleService` sets.
#[derive(Clone)]
struct QuotaPath(String);

#[derive(Clone)]
pub struct IpPath {
    pub trusted_header: Option<crate::client_ip::ClientIpHeader>,
}
impl KeyExtractor for IpPath {
    type Key = (Option<IpAddr>, String);
    fn extract<T>(&self, request: &Request<T>) -> Result<Self::Key, GovernorError> {
        let QuotaPath(path) = request
            .extensions()
            .get::<QuotaPath>()
            .ok_or(GovernorError::UnableToExtractKey)?;
        Ok((
            crate::client_ip::resolve(
                request.headers(),
                request.extensions(),
                self.trusted_header.as_ref(),
            ),
            path.clone(),
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
    fn as_str(self) -> &'static str {
        match self {
            Self::Exact(value) | Self::Prefix(value) => value,
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
    /// First matching group wins. A request to a route counts under the route's template,
    /// so routes in a group don't spend each other's quotas. Any other request counts under
    /// the pattern it matched, so the keys can't grow with the paths callers send. Apply
    /// it with `route_layer` and to the fallback. Cleanup ends when every layer is dropped.
    pub fn new(
        rules: Vec<Rule>,
        trusted_header: Option<crate::client_ip::ClientIpHeader>,
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
    fn call(&mut self, mut request: Request<Body>) -> Self::Future {
        let quota = match request.extensions().get::<MatchedPath>() {
            Some(route) => {
                let template = route.as_str();
                self.groups
                    .iter()
                    .find(|g| g.paths.iter().any(|p| p.matches(template)))
                    .map(|g| (g, template.to_owned()))
            }
            None => {
                let path = path(request.uri().path());
                self.groups.iter().find_map(|g| {
                    g.paths
                        .iter()
                        .find(|p| p.matches(path))
                        .map(|p| (g, p.as_str().to_owned()))
                })
            }
        };
        let inner = self.inner.clone();
        match quota {
            Some((group, key)) => {
                let layer = group.layer.clone();
                request.extensions_mut().insert(QuotaPath(key));
                Box::pin(layer.layer(inner).oneshot(request))
            }
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

    #[tokio::test]
    async fn keys_hold_route_templates_or_patterns_and_ignore_queries_and_spoofed_headers() {
        fn refusal(_: GovernorError) -> Response {
            let mut response = Response::new(Body::empty());
            *response.status_mut() = axum::http::StatusCode::TOO_MANY_REQUESTS;
            response
        }
        let layer = RuleLayer::new(
            vec![
                Rule {
                    paths: vec![Pattern::Prefix("/auth/sign-in")],
                    window: Duration::from_secs(60),
                    max: 1,
                },
                Rule {
                    paths: vec![Pattern::Prefix("/auth/")],
                    window: Duration::from_secs(60),
                    max: 1,
                },
            ],
            None,
            refusal,
        )
        .unwrap();
        async fn ok() -> &'static str {
            "ok"
        }
        let app = axum::Router::new()
            .route("/auth/sign-in/email", axum::routing::get(ok))
            .route("/auth/sign-in/social", axum::routing::get(ok))
            .route("/auth/callback/{id}", axum::routing::get(ok))
            .route_layer(layer.clone())
            .fallback_service(layer.layer(tower::service_fn(|_: Request<Body>| async {
                Ok::<_, std::convert::Infallible>(Response::new(Body::empty()))
            })));
        for (path, address, status) in [
            ("/auth/sign-in/email?a=1", "192.0.2.1", 200),
            ("/auth/sign-in/email?a=2", "192.0.2.1", 429),
            ("/auth/sign-in/email", "192.0.2.2", 200),
            // Routes in one group keep their own quotas.
            ("/auth/sign-in/social", "192.0.2.1", 200),
            // One template, whatever its parameters.
            ("/auth/callback/google", "192.0.2.1", 200),
            ("/auth/callback/github", "192.0.2.1", 429),
            // Paths without a route share their pattern's quota.
            ("/auth/sign-in/unknown-1", "192.0.2.1", 200),
            ("/auth/sign-in/unknown-2", "192.0.2.1", 429),
            ("/auth/unknown-1", "192.0.2.1", 200),
            ("/auth/unknown-2", "192.0.2.1", 429),
            ("/elsewhere", "192.0.2.1", 200),
            ("/elsewhere", "192.0.2.1", 200),
        ] {
            let mut request = Request::builder()
                .uri(path)
                .header("x-forwarded-for", "203.0.113.1")
                .body(Body::empty())
                .unwrap();
            request
                .extensions_mut()
                .insert(ConnectInfo(std::net::SocketAddr::new(
                    address.parse().unwrap(),
                    1000,
                )));
            let response = app.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status().as_u16(), status, "{path} from {address}");
        }
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
