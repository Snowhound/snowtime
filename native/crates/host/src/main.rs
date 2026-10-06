mod config;
mod edge;
mod memory;
mod pages;

use axum::Router;
use std::sync::Arc;

async fn shutdown() {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("SIGTERM handler");
    tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
}

fn main() {
    snowtime_server::clock::init_from_env();
    let config = config::from_env().unwrap_or_else(|message| panic!("{message}"));
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .max_blocking_threads(config.limits.db_calls + config.limits.hashes)
        .enable_all()
        .build()
        .expect("the host runtime starts");
    runtime.block_on(serve(config));
}
async fn serve(config: config::Config) {
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("one TLS provider");
    let _logs = edge::init_logs(&config.edge);
    let address = tokio::net::lookup_host((config.host.as_str(), config.port))
        .await
        .expect("HOST resolves")
        .next()
        .expect("HOST has an address");
    let origin = config.server.app_url.clone();
    // Before the listener starts, so no request writes during a migration.
    if let Some(folder) = &config.migrations {
        let mut db =
            rusqlite::Connection::open(&config.server.database_path).expect("the database opens");
        db.busy_timeout(std::time::Duration::from_secs(5))
            .expect("busy timeout");
        match snowtime_server::migrations::migrate(&mut db, folder) {
            Ok(applied) => tracing::info!(applied, "migrations applied"),
            Err(error) => panic!("Migrations failed: {error}"),
        }
    }
    let app = snowtime_server::App::open_with_limits(
        config.server,
        config.read_connections,
        config.limits,
    )
    .expect("the database opens");
    let api = snowtime_server::router(app.clone());

    let limit = memory::limit();
    let cpus = std::thread::available_parallelism().map_or(1, |n| n.get());
    let policy = memory::policy(&limit, cpus, config.renderers);
    tracing::info!(
        limit_mib = limit.bytes >> 20,
        source = limit.source,
        cpus,
        renderers = policy.max_renderers,
        heap_mib = policy.heap_limit_bytes >> 20,
        "sized the renderers"
    );
    let pool = snowtime_render::Pool::start(
        pages::in_process(api.clone()),
        snowtime_render::MANIFEST,
        policy,
    )
    .expect("the renderer starts");
    memory::watch(pool.clone(), limit.bytes);
    #[cfg(feature = "bench")]
    {
        let pool = pool.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                let stats = pool.stats();
                tracing::info!(renderers = stats.renderers, render_queued = stats.queued, render_busy_answers = stats.refused,
                    database = %app.bench_stats(), "bench counters");
            }
        });
    }
    let pages = Router::new()
        .fallback(pages::page)
        .with_state(Arc::new(pages::Pages {
            pool,
            app_url: origin.clone(),
        }));

    let router = edge::router(api, pages, &config.edge, &origin);
    let handle = axum_server::Handle::new();
    let shutdown_handle = handle.clone();
    tokio::spawn(async move {
        shutdown().await;
        shutdown_handle.graceful_shutdown(Some(std::time::Duration::from_secs(10)));
    });
    let redirect = config.edge.redirect_port.map(|port| {
        assert_ne!(port, config.port, "HTTP_REDIRECT_PORT differs from PORT");
        let address = std::net::SocketAddr::new(address.ip(), port);
        let handle = handle.clone();
        let listener =
            std::net::TcpListener::bind(address).expect("the HTTP redirect port is free");
        listener
            .set_nonblocking(true)
            .expect("nonblocking redirect listener");
        tokio::spawn(async move {
            axum_server::from_tcp(listener)
                .expect("the redirect listener initializes")
                .acceptor(axum_server::accept::NoDelayAcceptor::new())
                .handle(handle)
                .serve(edge::redirects(origin).into_make_service())
                .await
                .expect("the HTTP redirect listener runs");
        })
    });
    tracing::info!(%address, tls = !matches!(config.edge.tls, edge::Tls::Plain), "listening");
    edge::serve(address, router, config.edge, handle)
        .await
        .expect("the server runs");
    if let Some(task) = redirect {
        task.abort();
    }
}
