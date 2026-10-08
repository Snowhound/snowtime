use super::schemas::{CreateSettingsInput, UpdateSettingsInput};
use crate::http::{App, AsUser, Response};
use axum::{Router, routing::put};
use std::sync::Arc;

pub fn routes() -> Router<Arc<App>> {
    Router::new().route("/settings", put(create).patch(update))
}
async fn create(call: AsUser<CreateSettingsInput>) -> Response {
    call.run(super::create_settings).await
}
async fn update(call: AsUser<UpdateSettingsInput>) -> Response {
    call.run(super::update_settings).await
}
