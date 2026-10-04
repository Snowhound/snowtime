use super::{AccessLog, Config};
use axum::{
    Router,
    body::{Body, Bytes, HttpBody},
    extract::{Request, State},
    middleware::{self, Next},
    response::Response,
};
use http_body::Frame;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::task::{Context, Poll};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tracing::Level;
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

pub fn init(config: &Config) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    let console =
        tracing_subscriber::fmt::layer()
            .json()
            .with_filter(tracing_subscriber::filter::filter_fn(|metadata| {
                metadata.target() != "snowtime_bench" && *metadata.level() <= Level::INFO
            }));
    let (file, guard) = config
        .bench_log
        .as_ref()
        .map(|path| {
            let writer = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .expect("EDGE_BENCH_LOG is writable");
            let (writer, guard) = tracing_appender::non_blocking::NonBlockingBuilder::default()
                .lossy(false)
                .finish(writer);
            let layer = tracing_subscriber::fmt::layer()
                .json()
                .with_writer(writer)
                .with_filter(tracing_subscriber::filter::filter_fn(|metadata| {
                    metadata.target() == "snowtime_bench"
                }));
            (layer, guard)
        })
        .unzip();
    tracing_subscriber::registry()
        .with(console)
        .with(file)
        .init();
    guard
}

// As Caddy samples its access log (deploy/compose/Caddyfile): the first 10 events each
// second, then one in 100.
#[derive(Default)]
struct Sampler {
    second: AtomicU64,
    count: AtomicU64,
}
impl Sampler {
    fn keep(&self, second: u64) -> bool {
        if self.second.swap(second, Ordering::Relaxed) != second {
            self.count.store(0, Ordering::Relaxed);
        }
        let n = self.count.fetch_add(1, Ordering::Relaxed);
        n < 10 || (n - 10).is_multiple_of(100)
    }
}

struct Logs {
    access: AccessLog,
    bench: bool,
    sampler: Sampler,
}

pub fn layer(router: Router, config: &Config) -> Router {
    let bench = config.bench_log.is_some();
    if config.access_log == AccessLog::Off && !bench {
        return router;
    }
    let logs = Arc::new(Logs {
        access: config.access_log,
        bench,
        sampler: Sampler::default(),
    });
    router.layer(middleware::from_fn_with_state(logs, log))
}

async fn log(State(logs): State<Arc<Logs>>, request: Request, next: Next) -> Response {
    let (kind, step) = if logs.bench {
        let header = |name| {
            request
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
        };
        (header("x-bench-kind"), header("x-bench-step"))
    } else {
        (None, None)
    };
    let began = Instant::now();
    let method = request.method().to_string();
    let path = request.uri().path().to_owned();
    let response = next.run(request).await;
    let status = response.status().as_u16();
    response.map(|body| {
        Body::new(Logged {
            body,
            logs,
            began,
            method,
            path,
            kind,
            step,
            status,
            size: 0,
        })
    })
}

// Logs when the body is dropped: after its last byte is sent, or when the client goes away,
// so the duration includes compression and backpressure.
struct Logged {
    body: Body,
    logs: Arc<Logs>,
    began: Instant,
    method: String,
    path: String,
    kind: Option<String>,
    step: Option<String>,
    status: u16,
    size: usize,
}
impl HttpBody for Logged {
    type Data = Bytes;
    type Error = axum::Error;
    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, axum::Error>>> {
        let polled = Pin::new(&mut self.body).poll_frame(cx);
        if let Poll::Ready(Some(Ok(frame))) = &polled
            && let Some(data) = frame.data_ref()
        {
            self.size += data.len();
        }
        polled
    }
    fn is_end_stream(&self) -> bool {
        self.body.is_end_stream()
    }
    fn size_hint(&self) -> http_body::SizeHint {
        self.body.size_hint()
    }
}
impl Drop for Logged {
    fn drop(&mut self) {
        let duration = self.began.elapsed().as_secs_f64();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let access = match self.logs.access {
            AccessLog::All => true,
            AccessLog::Sampled => self.logs.sampler.keep(now.as_secs()),
            AccessLog::Off => false,
        };
        if access {
            tracing::info!(target: "snowtime_access", method = %self.method,
                path = %self.path, status = self.status, duration, size = self.size, "access");
        }
        if let Some(kind) = &self.kind {
            tracing::info!(target: "snowtime_bench", ts = now.as_secs_f64(), kind = %kind,
                step = self.step.as_deref().unwrap_or(""), status = self.status, duration,
                size = self.size, "access");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Sampler;

    #[test]
    fn samples_like_caddy() {
        let sampler = Sampler::default();
        let kept = (0..1_000).filter(|_| sampler.keep(7)).count();
        assert_eq!(kept, 10 + 10);
        assert!(sampler.keep(8), "a new second starts over");
    }
}
