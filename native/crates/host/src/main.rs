mod config;
mod edge;

async fn shutdown() {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("SIGTERM handler");
    tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
}

#[tokio::main]
async fn main() {
    snowtime_server::clock::init_from_env();
    let config = config::from_env().unwrap_or_else(|message| panic!("{message}"));
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
    let app = snowtime_server::App::open(config.server).expect("the database opens");
    let router = edge::router(snowtime_server::router(app), &config.edge, &origin);
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
