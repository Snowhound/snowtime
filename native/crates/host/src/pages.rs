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
/// the page's cookie, which the bundle adds to each.
pub fn in_process(api: Router) -> SendApi {
    Arc::new(move |call| {
        let api = api.clone();
        Box::pin(async move {
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
        })
    })
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
    let headers = request
        .headers()
        .iter()
        .filter_map(|(n, v)| Some((n.to_string(), v.to_str().ok()?.to_owned())))
        .collect();
    let cookie = request
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
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
                headers.insert("server-timing", timing);
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
        Err(RenderError::Failed(error)) => {
            eprintln!("[render] {path}: {error}");
            text(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The page failed to render.",
            )
        }
    }
}
