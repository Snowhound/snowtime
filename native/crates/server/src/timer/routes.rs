use super::schemas::*;
use crate::http::{App, AsUser, InOrganization, KEYS, Response};
use crate::schemas::Empty;
use axum::{
    Router,
    handler::Handler,
    routing::{get, post},
};
use std::sync::Arc;
pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/timer", get(running.layer(KEYS)))
        .route("/timer/stop", post(stop.layer(KEYS)))
}
pub fn organization_routes() -> Router<Arc<App>> {
    Router::new().route("/timer/start", post(start.layer(KEYS)))
}
async fn running(call: AsUser<Empty>) -> Response {
    call.run(|db, user, _| super::get_running_timer(db, user))
        .await
}
async fn stop(call: AsUser<StopTimerInput>) -> Response {
    call.run(super::stop_timer).await
}
async fn start(call: InOrganization<StartTimerInput>) -> Response {
    call.run(super::start_timer).await
}
