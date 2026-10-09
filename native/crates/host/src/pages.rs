//! Pages: the renderer's pool, its API calls made in process through the router, and the
//! answer when the renderers are busy.
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{ConnectInfo, Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::Engine;
use rand::RngExt;
use snowtime_render::{ApiResponse, PageRequest, Pool, RenderError, SendApi};
use snowtime_server::ServiceExt;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

// The only headers a page's JavaScript may set on an API call; the host adds the cookie and
// the client's address itself.
const PAGE_HEADERS: [header::HeaderName; 2] = [header::CONTENT_TYPE, header::ACCEPT];

/// The render isolate's API calls, through the API router as the browser's would go. A page
/// may only read: GET under `/api/v1`, or POST to the report calls, which read with a filter
/// body. It sets only the method, path, body, and `PAGE_HEADERS`; the call carries the page's
/// cookie and client address as the renderer gives them, so it can't pass as another origin
/// or address. A call runs on the host's runtime and is aborted when the page drops it, as
/// when the page fails or times out, and its answer is read only up to the page's limit.
pub fn in_process(
    api: Router,
    client_ip_header: Option<snowtime_server::client_ip::ClientIpHeader>,
) -> SendApi {
    let runtime = tokio::runtime::Handle::current();
    Arc::new(move |call| {
        let api = api.clone();
        let runtime = runtime.clone();
        let client_ip_header = client_ip_header.clone();
        Box::pin(async move {
            let path = call
                .path
                .split_once('?')
                .map_or(&*call.path, |(path, _)| path);
            if !page_may_call(&call.method, path) {
                return Err(format!(
                    "A page may only read the API: {} {path}",
                    call.method
                ));
            }
            let mut task = AbortOnDrop(runtime.spawn(async move {
                let mut request = Request::builder()
                    .method(call.method.as_str())
                    .uri(call.path);
                for (name, value) in call.headers {
                    if PAGE_HEADERS
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(allowed.as_str()))
                    {
                        request = request.header(name, value);
                    }
                }
                if !call.cookie.is_empty() {
                    request = request.header(header::COOKIE, call.cookie);
                }
                if let Some(client) = call.client {
                    if let Some(trusted) = &client_ip_header {
                        request = request.header(&trusted.name, client.to_string());
                    }
                    request = request.extension(ConnectInfo(SocketAddr::new(client, 0)));
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
                let body = to_bytes(response.into_body(), call.max_body_bytes)
                    .await
                    .map_err(|_| "The API answer is larger than the page's limit".to_owned())?
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

// Reads only; the report calls take their filters as a body (server/src/reports/routes.rs).
fn page_may_call(method: &str, path: &str) -> bool {
    let Some(rest) = path.strip_prefix("/api/v1/") else {
        return false;
    };
    let segments: Vec<&str> = rest.split('/').collect();
    if segments
        .iter()
        .any(|s| s.is_empty() || *s == "." || *s == "..")
    {
        return false;
    }
    match method {
        "GET" => true,
        "POST" => matches!(
            segments.as_slice(),
            ["organizations", _, "report"]
                | [
                    "organizations",
                    _,
                    "report",
                    "breakdown" | "entries" | "entry-totals" | "export"
                ]
        ),
        _ => false,
    }
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
    // CLIENT_IP_HEADER, for the address the page's API calls carry.
    pub client_ip_header: Option<snowtime_server::client_ip::ClientIpHeader>,
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
    let client = snowtime_server::client_ip::resolve(
        request.headers(),
        request.extensions(),
        pages.client_ip_header.as_ref(),
    );
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
            client,
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
        Err(RenderError::Failed(error)) => render_failed(request.uri(), &error),
    }
}

// The path only: a query may carry an invitation or OAuth token.
fn render_failed(uri: &axum::http::Uri, error: &str) -> Response {
    tracing::error!(path = uri.path(), %error, "render failed");
    text(
        StatusCode::INTERNAL_SERVER_ERROR,
        "The page failed to render.",
    )
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
            in_process(api, None),
            snowtime_render::MANIFEST,
            Default::default(),
        )
        .unwrap();
        let router = Router::new().fallback(page).with_state(Arc::new(Pages {
            pool,
            app_url: "http://snowtime.test".into(),
            client_ip_header: None,
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

    #[test]
    fn a_failed_render_logs_the_path_without_its_query() {
        #[derive(Clone, Default)]
        struct Logs(Arc<std::sync::Mutex<Vec<u8>>>);
        impl std::io::Write for Logs {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(bytes);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let logs = Logs::default();
        let writer = logs.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(move || writer.clone())
            .with_ansi(false)
            .finish();
        let response = tracing::subscriber::with_default(subscriber, || {
            render_failed(&"/invite/accept?token=secret".parse().unwrap(), "boom")
        });
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let logged = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
        assert!(logged.contains(r#"path="/invite/accept""#), "{logged}");
        assert!(!logged.contains("secret"), "{logged}");
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
            "/api/v1/stuck",
            axum::routing::get(move || {
                let events = events.clone();
                async move {
                    let _dropped = Dropped(events.clone());
                    let _ = events.send("called");
                    std::future::pending::<()>().await;
                }
            }),
        );
        let call = in_process(api, None)(call("GET", "/api/v1/stuck"));
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

    fn call(method: &str, path: &str) -> ApiRequest {
        ApiRequest {
            method: method.into(),
            path: path.into(),
            headers: vec![],
            body: vec![],
            cookie: String::new(),
            client: None,
            max_body_bytes: 1 << 20,
        }
    }

    // L8 of task 081.30: page JavaScript chooses only what a read needs.
    #[tokio::test]
    async fn a_page_may_only_read_and_the_host_sets_who_is_calling() {
        async fn echo(request: Request) -> String {
            if request.uri().path().ends_with("large") {
                return "x".repeat(2 << 20);
            }
            let headers = request.headers();
            let header = |name: &str| headers.get(name).map(|v| v.to_str().unwrap().to_owned());
            let peer = request
                .extensions()
                .get::<ConnectInfo<SocketAddr>>()
                .map(|info| info.0.ip().to_string());
            format!(
                "{} {:?} {:?} {:?} {:?} {:?}",
                request.uri(),
                header("cookie"),
                header("x-client-ip"),
                header("content-type"),
                header("origin")
                    .or(header("host"))
                    .or(header("x-forwarded-for")),
                peer,
            )
        }
        let api = Router::new().fallback(echo);
        let send = in_process(
            api,
            Some(snowtime_server::client_ip::ClientIpHeader {
                name: "x-client-ip".into(),
                proxies: vec![],
            }),
        );
        let answer = |request| {
            let send = send.clone();
            async move {
                send(request)
                    .await
                    .map(|r| String::from_utf8(r.body).unwrap())
            }
        };

        let page = ApiRequest {
            headers: [
                ("content-type", "application/json"),
                ("cookie", "session=javascript"),
                ("origin", "https://elsewhere.example"),
                ("host", "elsewhere.example"),
                ("x-client-ip", "198.51.100.1"),
                ("x-forwarded-for", "198.51.100.2"),
            ]
            .map(|(n, v)| (n.into(), v.into()))
            .into(),
            cookie: "session=page".into(),
            client: Some("203.0.113.5".parse().unwrap()),
            ..call("GET", "/api/v1/timer?at=1")
        };
        assert_eq!(
            answer(page).await.unwrap(),
            r#"/api/v1/timer?at=1 Some("session=page") Some("203.0.113.5") Some("application/json") None Some("203.0.113.5")"#
        );
        assert!(
            answer(call("POST", "/api/v1/organizations/o/report/entries"))
                .await
                .is_ok()
        );
        for (method, path) in [
            ("POST", "/api/v1/organizations/o/entries"),
            ("PATCH", "/api/v1/organizations/o/report"),
            ("DELETE", "/api/v1/timer"),
            ("GET", "/api/auth/get-session"),
            ("GET", "/api/v1/../auth/get-session"),
            ("GET", "/api/v1//timer"),
            ("GET", "/livez"),
        ] {
            let refused = answer(call(method, path)).await;
            assert!(
                matches!(&refused, Err(e) if e.starts_with("A page may only read")),
                "{method} {path}: {refused:?}"
            );
        }
        // The answer is read only up to the page's limit.
        let refused = answer(call("GET", "/api/v1/large")).await;
        assert!(matches!(refused, Err(e) if e.contains("limit")));
    }
}
