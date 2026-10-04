mod config;
mod memory;
mod pages;

use axum::{
    Router,
    extract::{Request, State},
    http::{HeaderValue, header},
    middleware::{self, Next},
    response::Response,
};
use snowtime_server::ServiceExt;
use std::sync::Arc;
use tower_http::services::ServeDir;

async fn shutdown() {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("SIGTERM handler");
    tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
}

// The build hashes the names in /assets/, so they never change; other public files keep
// their names and are cached for a week, as deploy/compose/Caddyfile sets them.
async fn cache_public_files(request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let cache = if path.starts_with("/assets/") {
        Some("public, max-age=31536000, immutable")
    } else if path.starts_with("/backgrounds/") || path.starts_with("/brand/") {
        Some("public, max-age=604800")
    } else {
        None
    };
    let mut response = next.run(request).await;
    if let Some(cache) = cache
        && response.status().is_success()
        && !response.headers().contains_key(header::CACHE_CONTROL)
    {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    }
    response
}

// The API answers every path under /api/, its unknown calls included; anything else is a
// public file or a page.
async fn dispatch(State((api, site)): State<(Router, Router)>, request: Request) -> Response {
    let target = if request.uri().path().starts_with("/api/") {
        api
    } else {
        site
    };
    target.oneshot(request).await.unwrap_or_else(|e| match e {})
}

#[tokio::main]
async fn main() {
    snowtime_server::clock::init_from_env();
    let config = config::from_env().unwrap_or_else(|message| panic!("{message}"));
    let address = (config.host.clone(), config.port);
    let app_url = config.server.app_url.clone();
    let app = snowtime_server::App::open(config.server).expect("the database opens");
    let api = snowtime_server::router(app);

    let limit = memory::limit();
    let cpus = std::thread::available_parallelism().map_or(1, |n| n.get());
    let policy = memory::policy(&limit, cpus, config.renderers);
    eprintln!(
        "[snowtime-axum] {} MiB of {}, {cpus} CPUs: up to {} renderers, {} MiB heap each",
        limit.bytes >> 20,
        limit.source,
        policy.max_renderers,
        policy.heap_limit_bytes >> 20
    );
    let pool = snowtime_render::Pool::start(
        pages::in_process(api.clone()),
        snowtime_render::MANIFEST,
        policy,
    )
    .expect("the renderer starts");
    memory::watch(pool.clone(), limit.bytes);

    let pages = Router::new()
        .fallback(pages::page)
        .with_state(Arc::new(pages::Pages { pool, app_url }));
    let site = match &config.public_dir {
        Some(dir) => Router::new().fallback_service(
            ServeDir::new(dir)
                .precompressed_br()
                .precompressed_zstd()
                .precompressed_gzip()
                .append_index_html_on_directories(false)
                .fallback(pages),
        ),
        None => pages,
    };
    let router = Router::new()
        .fallback(dispatch)
        .with_state((api, site))
        .layer(middleware::from_fn(cache_public_files));

    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("the port is free");
    eprintln!(
        "[snowtime-axum] Listening on {}",
        listener.local_addr().unwrap()
    );
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown())
        .await
        .expect("the server runs");
}
