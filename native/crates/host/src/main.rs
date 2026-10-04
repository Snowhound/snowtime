mod config;

async fn shutdown() {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("SIGTERM handler");
    tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
}

#[tokio::main]
async fn main() {
    snowtime_server::clock::init_from_env();
    let config = config::from_env().unwrap_or_else(|message| panic!("{message}"));
    let address = (config.host.clone(), config.port);
    let app = snowtime_server::App::open(config.server).expect("the database opens");
    let router = snowtime_server::router(app);
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
