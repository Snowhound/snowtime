//! Pages: the renderer's pool, its API calls made in process through the router, and the
//! answer when the renderers are busy.
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::Engine;
use rand::RngExt;
use snowtime_render::{ApiResponse, PageRequest, Pool, RenderError, SendApi};
use snowtime_server::ServiceExt;
use std::sync::Arc;
use std::time::Instant;

/// The render isolate's API calls, through the API router as the browser's would go, with
/// the page's cookie, which the bundle adds to each. A call runs on the host's runtime and
/// is aborted when the page drops it, as when the page is cancelled or times out.
pub fn in_process(api: Router) -> SendApi {
    let runtime = tokio::runtime::Handle::current();
    Arc::new(move |call| {
        let api = api.clone();
        let runtime = runtime.clone();
        Box::pin(async move {
            let mut task = AbortOnDrop(runtime.spawn(async move {
                let mut request = Request::builder()
                    .method(call.method.as_str())
                    .uri(call.path);
                for (name, value) in call.headers {
                    request = request.header(name, value);
                }
                let request = request
                    .body(Body::from(call.body))
                    .map_err(|e| e.to_string())?;
                let response = api.oneshot(request).await.unwrap_or_else(|e| match e {});
                let status = response.status().as_u16();
                let headers = response
                    .headers()
                    .iter()
                    .filter_map(|(n, v)| Some((n.to_string(), v.to_str().ok()?.to_owned())))
                    .collect();
                let body = to_bytes(response.into_body(), usize::MAX)
                    .await
                    .map_err(|e| e.to_string())?
                    .to_vec();
                Ok(ApiResponse {
                    status,
                    headers,
                    body,
                })
            }));
            (&mut task.0).await.map_err(|e| e.to_string())?
        })
    })
}

// Dropping a Tokio JoinHandle detaches its task; this aborts it instead.
struct AbortOnDrop<T>(tokio::task::JoinHandle<T>);
impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub struct Pages {
    pub pool: Pool,
    // The public URL; behind a proxy the request's own URL may differ.
    pub app_url: String,
}

// A fresh CSP nonce per page (newNonce in src/server/csp.server.ts).
fn nonce() -> String {
    let bytes: [u8; 16] = rand::rng().random();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn text(status: StatusCode, message: &'static str) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], message).into_response()
}

pub async fn page(State(pages): State<Arc<Pages>>, request: Request) -> Response {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        let mut refused = text(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed.");
        refused
            .headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
        return refused;
    }
    let cookie = snowtime_server::http::cookies(request.headers()).unwrap_or_default();
    // One Cookie header, however HTTP/2 split it.
    let mut headers: Vec<(String, String)> = request
        .headers()
        .iter()
        .filter(|(n, _)| *n != header::COOKIE)
        .filter_map(|(n, v)| Some((n.to_string(), v.to_str().ok()?.to_owned())))
        .collect();
    if !cookie.is_empty() {
        headers.push(("cookie".into(), cookie.clone()));
    }
    let path = request.uri().path_and_query().map_or("/", |p| p.as_str());
    let started = Instant::now();
    let rendered = pages
        .pool
        .render(PageRequest {
            url: format!("{}{path}", pages.app_url),
            method: "GET".into(),
            headers,
            cookie,
            nonce: nonce(),
            locale: None,
            now: snowtime_server::clock::is_shifted().then(snowtime_server::clock::now),
        })
        .await;
    match rendered {
        Ok(page) => {
            let mut response = Response::new(Body::from(page.body));
            *response.status_mut() =
                StatusCode::from_u16(page.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            let headers = response.headers_mut();
            for (name, value) in page.headers {
                if name == "content-length" || name == "transfer-encoding" {
                    continue;
                }
                if let (Ok(name), Ok(value)) = (
                    header::HeaderName::try_from(name),
                    HeaderValue::try_from(value),
                ) {
                    headers.append(name, value);
                }
            }
            let timing = format!("render;dur={:.1}", started.elapsed().as_secs_f64() * 1000.0);
            if let Ok(timing) = HeaderValue::try_from(timing) {
                headers.append("server-timing", timing);
            }
            response
        }
        // Every renderer is busy and the queue is full, or the page waited too long.
        Err(RenderError::Busy) => {
            let mut busy = text(
                StatusCode::SERVICE_UNAVAILABLE,
                "The server is busy. Try again.",
            );
            busy.headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
            busy
        }
        Err(RenderError::ApiRefused { retry_after }) => {
            let mut busy = text(
                StatusCode::SERVICE_UNAVAILABLE,
                "The server is busy. Try again.",
            );
            busy.headers_mut().insert(
                header::RETRY_AFTER,
                HeaderValue::try_from(retry_after)
                    .unwrap_or_else(|_| HeaderValue::from_static("1")),
            );
            busy
        }
        Err(RenderError::Down) => text(
            StatusCode::SERVICE_UNAVAILABLE,
            "Pages are unavailable. Try again later.",
        ),
        Err(RenderError::Failed(error)) => {
            tracing::error!(path, %error, "render failed");
            text(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The page failed to render.",
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use snowtime_render::ApiRequest;
    use std::time::Duration;
    use tokio::sync::mpsc;

    #[tokio::test(flavor = "multi_thread")]
    async fn a_refused_api_dependency_refuses_the_page_and_keeps_retry_after() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let api = Router::new().fallback(move || {
            observed.fetch_add(1, Ordering::SeqCst);
            async {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    [(header::RETRY_AFTER, "7")],
                    r#"{"error":"The server is busy. Try again."}"#,
                )
            }
        });
        let pool = Pool::start(
            in_process(api),
            snowtime_render::MANIFEST,
            Default::default(),
        )
        .unwrap();
        let router = Router::new().fallback(page).with_state(Arc::new(Pages {
            pool,
            app_url: "http://snowtime.test".into(),
        }));
        let response = router
            .oneshot(
                Request::get("/lumen/timer")
                    .header(header::COOKIE, "session=test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(calls.load(Ordering::SeqCst) > 0);
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers()[header::RETRY_AFTER], "7");
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    }

    #[tokio::test]
    async fn dropping_a_call_aborts_it_on_the_host_runtime() {
        struct Dropped(mpsc::UnboundedSender<&'static str>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                let _ = self.0.send("dropped");
            }
        }
        let (events, mut received) = mpsc::unbounded_channel();
        let api = Router::new().route(
            "/stuck",
            axum::routing::get(move || {
                let events = events.clone();
                async move {
                    let _dropped = Dropped(events.clone());
                    let _ = events.send("called");
                    std::future::pending::<()>().await;
                }
            }),
        );
        let call = in_process(api)(ApiRequest {
            method: "GET".into(),
            path: "/stuck".into(),
            headers: vec![],
            body: vec![],
        });
        let call = tokio::spawn(call);
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), received.recv())
                .await
                .unwrap(),
            Some("called")
        );
        call.abort();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), received.recv())
                .await
                .unwrap(),
            Some("dropped")
        );
    }
}
