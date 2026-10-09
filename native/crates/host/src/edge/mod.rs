mod accept;
mod access;
mod acme_cache;
mod config;
mod connections;
mod files;
pub use access::init as init_logs;
pub use config::{AccessLog, Config, Tls};

use axum::{
    Router,
    extract::{Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
};
use snowtime_server::ServiceExt;
use std::time::Duration;
use tower_http::{
    catch_panic::CatchPanicLayer,
    compression::{
        CompressionLayer,
        predicate::{DefaultPredicate, Predicate, SizeAbove},
    },
    limit::RequestBodyLimitLayer,
    services::ServeDir,
};

// The API's routes, then a public file, then a page. Unknown API paths, dotfiles, and
// archives keep the API's refusal even if a file exists. Only paths in the startup index
// of the public directory reach the disk.
pub fn router(api: Router, pages: Router, config: &Config, app_url: &str) -> Router {
    let site = match &config.static_dir {
        Some(directory) => {
            let index = files::Index::list(directory).expect("EDGE_STATIC_DIR is readable");
            tracing::info!(files = index.len(), "indexed the public files");
            Router::new()
                .fallback_service(
                    ServeDir::new(directory)
                        .fallback(pages.clone())
                        .append_index_html_on_directories(false)
                        .precompressed_br()
                        .precompressed_zstd()
                        .precompressed_gzip(),
                )
                .layer(middleware::from_fn_with_state(
                    std::sync::Arc::new((index, pages)),
                    indexed,
                ))
        }
        None => pages,
    };
    let mut router = api
        .clone()
        .fallback_service(site.layer(middleware::from_fn_with_state(api, static_cache)));
    if config.compression {
        router = router.layer(
            CompressionLayer::new()
                .compress_when(DefaultPredicate::new().and(SizeAbove::new(1024))),
        );
    }
    if config.body_limit > 0 {
        router = router
            .layer(RequestBodyLimitLayer::new(config.body_limit))
            .layer(middleware::from_fn_with_state(
                config.body_limit,
                declared_body_limit,
            ));
    }
    if config.uri_limit > 0 {
        router = router.layer(middleware::from_fn_with_state(config.uri_limit, uri_limit));
    }
    if config.timeout_seconds > 0 {
        router = router.layer(middleware::from_fn_with_state(
            Duration::from_secs(config.timeout_seconds),
            deadline,
        ));
    }
    // The API answers its own panics with its JSON 500; this covers pages and the rest.
    router = router.layer(CatchPanicLayer::custom(|_| {
        text(StatusCode::INTERNAL_SERVER_ERROR, "Internal error.")
    }));
    if config.headers {
        router = router.layer(middleware::from_fn_with_state(
            app_url.starts_with("https://"),
            security_headers,
        ));
    }
    access::layer(router, config)
}

async fn indexed(
    State(site): State<std::sync::Arc<(files::Index, Router)>>,
    request: Request,
    next: Next,
) -> Response {
    let (index, pages) = &*site;
    if index.contains(request.uri().path()) {
        next.run(request).await
    } else {
        pages.clone().oneshot(request).await.unwrap()
    }
}

fn is_api(path: &str) -> bool {
    path == "/api" || path.starts_with("/api/")
}
fn text(status: StatusCode, message: &'static str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        message,
    )
        .into_response()
}
// The API's own refusal on its paths, so its clients read it as any other.
fn refusal(api: bool, status: StatusCode, message: &'static str) -> Response {
    let mut response = if api {
        snowtime_server::http::Response::from(snowtime_server::wire::failure(
            status.as_u16(),
            message,
        ))
        .into_response()
    } else {
        text(status, message)
    };
    if status == StatusCode::SERVICE_UNAVAILABLE {
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
    }
    response
}

// A declared length past the limit, answered before `RequestBodyLimitLayer`'s plain-text
// 413 so the API's paths get its JSON refusal. A longer body without one fails as the API
// reads it, with the same refusal.
async fn declared_body_limit(State(limit): State<usize>, request: Request, next: Next) -> Response {
    let declared = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok()?.parse::<u64>().ok());
    if is_api(request.uri().path()) && declared.is_some_and(|length| length > limit as u64) {
        return refusal(
            true,
            StatusCode::PAYLOAD_TOO_LARGE,
            "Request body too large.",
        );
    }
    next.run(request).await
}

// Before routing, so no path of any length reaches the rate limits or the API.
async fn uri_limit(State(limit): State<usize>, request: Request, next: Next) -> Response {
    let uri = request.uri();
    if uri.path_and_query().map_or(0, |p| p.as_str().len()) > limit {
        return refusal(
            is_api(uri.path()),
            StatusCode::URI_TOO_LONG,
            "The request URI is too long.",
        );
    }
    next.run(request).await
}

// 503 rather than 408, which browsers may resend on their own while the first attempt's
// write still commits.
async fn deadline(State(limit): State<Duration>, request: Request, next: Next) -> Response {
    let api = is_api(request.uri().path());
    tokio::time::timeout(limit, next.run(request))
        .await
        .unwrap_or_else(|_| {
            refusal(
                api,
                StatusCode::SERVICE_UNAVAILABLE,
                "The server is busy. Try again.",
            )
        })
}

async fn security_headers(State(https): State<bool>, request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    if https {
        headers.insert(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        );
    }
    for (name, value) in [
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "strict-origin-when-cross-origin"),
        (
            "permissions-policy",
            "camera=(), microphone=(), geolocation=(), payment=()",
        ),
    ] {
        headers.insert(name, HeaderValue::from_static(value));
    }
    headers.entry("content-security-policy").or_insert(HeaderValue::from_static("default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"));
    headers
        .entry(header::CACHE_CONTROL)
        .or_insert(HeaderValue::from_static("private, no-store"));
    headers.remove(header::SERVER);
    response
}
async fn static_cache(State(api_router): State<Router>, request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let cache = if path.starts_with("/assets/") {
        "public, max-age=31536000, immutable"
    } else if path.starts_with("/backgrounds/") || path.starts_with("/brand/") {
        "public, max-age=604800"
    } else {
        "public, max-age=0"
    };
    let decoded = percent_encoding::percent_decode_str(path).decode_utf8_lossy();
    let hidden = !decoded.starts_with("/.well-known/")
        && decoded.split('/').any(|part| part.starts_with('.'));
    let archive = [".bak", ".old", ".sql", ".zip", ".tar", ".gz", ".tgz", ".7z"]
        .iter()
        .any(|suffix| decoded.to_ascii_lowercase().ends_with(suffix));
    let api = decoded == "/api" || decoded.starts_with("/api/") || hidden || archive;
    if api {
        return api_router.oneshot(request).await.unwrap();
    }
    let mut response = next.run(request).await;
    // Pages set their own.
    if response.status().is_success() {
        response
            .headers_mut()
            .entry(header::CACHE_CONTROL)
            .or_insert(HeaderValue::from_static(cache));
    }
    response
}

pub fn redirects(origin: String) -> Router {
    Router::new().fallback(move |request: Request| {
        let origin = origin.clone();
        async move {
            let path = request
                .uri()
                .path_and_query()
                .map(|p| p.as_str())
                .unwrap_or("/");
            Redirect::permanent(&format!("{origin}{path}"))
        }
    })
}

// Every listener gets hyper's timers and the acceptor's caps and idle timeout.
fn listener<A>(
    mut server: axum_server::Server<std::net::SocketAddr>,
    acceptor: A,
    config: &Config,
    handle: axum_server::Handle<std::net::SocketAddr>,
) -> axum_server::Server<std::net::SocketAddr, connections::Guard<A>> {
    connections::tune(server.http_builder(), config.header_timeout);
    server
        .acceptor(connections::Guard::new(
            acceptor,
            config.connections.clone(),
        ))
        .handle(handle)
}

/// The HTTP listener that redirects to the TLS one.
pub async fn serve_redirects(
    listener: std::net::TcpListener,
    origin: String,
    config: &Config,
    handle: axum_server::Handle<std::net::SocketAddr>,
) -> std::io::Result<()> {
    self::listener(
        axum_server::from_tcp(listener)?,
        axum_server::accept::NoDelayAcceptor::new(),
        config,
        handle,
    )
    .serve(redirects(origin).into_make_service())
    .await
}

pub async fn serve(
    address: std::net::SocketAddr,
    router: Router,
    config: Config,
    handle: axum_server::Handle<std::net::SocketAddr>,
) -> std::io::Result<()> {
    let service = router.into_make_service_with_connect_info::<std::net::SocketAddr>();
    let server = axum_server::bind(address);
    match &config.tls {
        Tls::Plain => {
            listener(
                server,
                axum_server::accept::NoDelayAcceptor::new(),
                &config,
                handle,
            )
            .serve(service)
            .await
        }
        Tls::Files { certificate, key } => {
            let tls =
                axum_server::tls_rustls::RustlsConfig::from_pem_file(certificate, key).await?;
            let acceptor = axum_server::tls_rustls::RustlsAcceptor::new(tls)
                .acceptor(axum_server::accept::NoDelayAcceptor::new());
            listener(server, acceptor, &config, handle)
                .serve(service)
                .await
        }
        Tls::Acme {
            domains,
            contact,
            cache,
            staging,
        } => {
            let mut state = rustls_acme::AcmeConfig::new(domains.clone())
                .contact(contact.clone())
                .cache(acme_cache::PrivateDirCache::new(cache.clone())?)
                .directory_lets_encrypt(!staging)
                .state();
            let mut tls = (*state.default_rustls_config()).clone();
            tls.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
            let acceptor = state.axum_acceptor(std::sync::Arc::new(tls));
            let poll = tokio::spawn(async move {
                use tokio_stream::StreamExt;
                while let Some(event) = state.next().await {
                    match event {
                        Ok(event) => tracing::info!(?event, "ACME event"),
                        Err(error) => tracing::error!(?error, "ACME failure"),
                    }
                }
            });
            let result = listener(server, accept::HandshakeTimeout(acceptor), &config, handle)
                .serve(service)
                .await;
            poll.abort();
            result
        }
    }
}

#[cfg(test)]
mod tests;
