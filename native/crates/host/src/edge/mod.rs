mod accept;
mod access;
mod config;
pub use access::init as init_logs;
pub use config::{Config, Tls};

use axum::{
    Router,
    extract::{Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{Redirect, Response},
};
use snowtime_server::ServiceExt;
use std::time::Duration;
use tower_http::{
    compression::{
        CompressionLayer,
        predicate::{DefaultPredicate, Predicate, SizeAbove},
    },
    limit::RequestBodyLimitLayer,
    services::ServeDir,
    timeout::TimeoutLayer,
};

pub fn router(api: Router, config: &Config, app_url: &str) -> Router {
    let mut router = api;
    if let Some(directory) = &config.static_dir {
        // Keep unknown API paths on the API's refusal contract, even if a file exists.
        let original = router.clone();
        let files = ServeDir::new(directory)
            .fallback(original.clone())
            .append_index_html_on_directories(false)
            .precompressed_br()
            .precompressed_zstd()
            .precompressed_gzip();
        let fallback = Router::new()
            .fallback_service(files)
            .layer(middleware::from_fn_with_state(original, static_cache));
        router = router.fallback_service(fallback);
    }
    if config.compression {
        router = router.layer(
            CompressionLayer::new()
                .compress_when(DefaultPredicate::new().and(SizeAbove::new(1024))),
        );
    }
    if config.body_limit > 0 {
        router = router.layer(RequestBodyLimitLayer::new(config.body_limit));
    }
    if config.timeout_seconds > 0 {
        router = router.layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(config.timeout_seconds),
        ));
    }
    if config.headers {
        router = router.layer(middleware::from_fn_with_state(
            app_url.starts_with("https://"),
            security_headers,
        ));
    }
    access::layer(router, config)
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
    if response.status().is_success() {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
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

pub async fn serve(
    address: std::net::SocketAddr,
    router: Router,
    config: Config,
    handle: axum_server::Handle<std::net::SocketAddr>,
) -> std::io::Result<()> {
    match config.tls {
        Tls::Plain => {
            axum_server::bind(address)
                .handle(handle)
                .serve(router.into_make_service())
                .await
        }
        Tls::Files { certificate, key } => {
            let tls =
                axum_server::tls_rustls::RustlsConfig::from_pem_file(certificate, key).await?;
            axum_server::bind_rustls(address, tls)
                .handle(handle)
                .serve(router.into_make_service())
                .await
        }
        Tls::Acme {
            domains,
            contact,
            cache,
            production,
        } => {
            use std::os::unix::fs::PermissionsExt;
            std::fs::create_dir_all(&cache)?;
            std::fs::set_permissions(&cache, std::fs::Permissions::from_mode(0o700))?;
            let mut state = rustls_acme::AcmeConfig::new(domains)
                .contact(contact)
                .cache(rustls_acme::caches::DirCache::new(cache))
                .directory_lets_encrypt(production)
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
            let result = axum_server::bind(address)
                .acceptor(accept::HandshakeTimeout(acceptor))
                .handle(handle)
                .serve(router.into_make_service())
                .await;
            poll.abort();
            result
        }
    }
}

#[cfg(test)]
mod tests;
