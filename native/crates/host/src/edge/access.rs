use super::Config;
use axum::{
    Router,
    body::{Body, Bytes, HttpBody},
    extract::Request,
    http::HeaderMap,
    response::Response,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tower_http::{classify::ServerErrorsFailureClass, trace::TraceLayer};
use tracing::{Level, Span};
use tracing_subscriber::{
    Layer,
    layer::SubscriberExt,
    registry::{LookupSpan, Registry},
    util::SubscriberInitExt,
};

pub fn init(config: &Config) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    let console = tracing_subscriber::fmt::layer()
        .json()
        .with_span_list(false)
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
                .with_span_list(false)
                .with_writer(writer)
                .with_filter(tracing_subscriber::filter::filter_fn(|metadata| {
                    matches!(metadata.target(), "snowtime_bench" | "snowtime_request")
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

struct Access {
    began: Instant,
    status: u16,
    size: usize,
}
fn update(span: &Span, change: impl FnOnce(&mut Access)) {
    span.with_subscriber(|(id, dispatch)| {
        let Some(registry) = dispatch.downcast_ref::<Registry>() else {
            return;
        };
        let Some(span) = registry.span(id) else {
            return;
        };
        if let Some(access) = span.extensions_mut().get_mut::<Access>() {
            change(access);
        }
    });
}
fn finish(span: &Span, access_log: bool, bench_log: bool) {
    let data = span
        .with_subscriber(|(id, dispatch)| {
            let registry = dispatch.downcast_ref::<Registry>()?;
            registry.span(id)?.extensions_mut().remove::<Access>()
        })
        .flatten();
    let Some(data) = data else { return };
    let _entered = span.enter();
    let status = data.status;
    let duration = data.began.elapsed().as_secs_f64();
    let size = data.size;
    if access_log {
        tracing::info!(target: "snowtime_access", status, duration, size, "access");
    }
    if bench_log {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        tracing::info!(target: "snowtime_bench", ts, status, duration, size, "access");
    }
}

pub fn layer(router: Router, config: &Config) -> Router {
    if !config.access_log && config.bench_log.is_none() {
        return router;
    }
    let access = config.access_log;
    let bench = config.bench_log.is_some();
    router.layer(TraceLayer::new_for_http()
        .make_span_with(|request: &Request| {
            let span = tracing::info_span!(target: "snowtime_request", "request", method = %request.method(), path = request.uri().path(),
                kind = request.headers().get("x-bench-kind").and_then(|v| v.to_str().ok()).unwrap_or(""),
                step = request.headers().get("x-bench-step").and_then(|v| v.to_str().ok()).unwrap_or(""));
            span.with_subscriber(|(id, dispatch)| {
                if let Some(registry) = dispatch.downcast_ref::<Registry>()
                    && let Some(span) = registry.span(id) {
                    span.extensions_mut().insert(Access { began: Instant::now(), status: 0, size: 0 });
                }
            });
            span
        })
        .on_request(())
        .on_response(move |response: &Response<Body>, _latency: Duration, span: &Span| {
            update(span, |data| data.status = response.status().as_u16());
            if response.body().is_end_stream() { finish(span, access, bench); }
        })
        .on_body_chunk(|chunk: &Bytes, _latency: Duration, span: &Span| {
            update(span, |data| data.size += chunk.len());
        })
        // Log after the body drains, so latency includes compression and backpressure.
        .on_eos(move |_trailers: Option<&HeaderMap>, _duration: Duration, span: &Span| {
            finish(span, access, bench);
        })
        .on_failure(move |failure: ServerErrorsFailureClass, _duration: Duration, span: &Span| {
            if matches!(failure, ServerErrorsFailureClass::Error(_)) {
                tracing::error!(?failure, "response stream failed");
                finish(span, access, bench);
            }
        }))
}
