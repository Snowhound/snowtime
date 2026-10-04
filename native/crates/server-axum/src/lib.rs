//! The proof of concept on Axum (task 081.03), with any query layer's rules. Every route goes
//! to the framework-free API (snowtime-api); Axum only carries requests.
use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use snowtime_api::{Api, Config, Request};
use snowtime_core::Rules;

fn text(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}

async fn call<R: Rules>(
    State(api): State<Arc<Api<R>>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let request = Request {
        method: method.as_str().to_owned(),
        path: uri.path().to_owned(),
        query: uri.query().map(str::to_owned),
        cookie: text(&headers, "cookie"),
        origin: text(&headers, "origin"),
        user_agent: text(&headers, "user-agent"),
        client_ip: api
            .config()
            .client_ip_header
            .as_deref()
            .and_then(|h| text(&headers, h)),
        body: body.to_vec(),
    };
    let answer = api.handle(request).await;
    let status = StatusCode::from_u16(answer.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut response = (status, answer.body).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(cookie) = answer
        .set_cookie
        .and_then(|c| HeaderValue::from_str(&c).ok())
    {
        headers.insert(header::SET_COOKIE, cookie);
    }
    response
}

async fn shutdown() {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("a SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = terminate.recv() => {}
    }
}

pub async fn serve<R: Rules>(name: &str, rules: R) {
    snowtime_core::clock::init_from_env();
    let config = Config::from_env().unwrap_or_else(|message| panic!("{message}"));
    let address = (config.host.clone(), config.port);
    let api = Api::open(config, rules).expect("the database opens");
    let app = Router::new().fallback(call::<R>).with_state(api);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("the port is free");
    eprintln!("[{name}] Listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await
        .expect("the server runs");
}
