use super::schemas::*;
use crate::http::{App, AsUser, Empty, InOrganization, Response};
use axum::{
    Router,
    routing::{get, post},
};
use std::sync::Arc;
pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/timer", get(running))
        .route("/timer/stop", post(stop))
}
pub fn organization_routes() -> Router<Arc<App>> {
    Router::new().route("/timer/start", post(start))
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
