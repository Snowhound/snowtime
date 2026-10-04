use super::schemas::*;
use crate::http::{App, InOrganization, Response};
use axum::{Router, routing::get};
use std::sync::Arc;

pub fn routes() -> Router<Arc<App>> {
    Router::new().route("/projects", get(list))
}
async fn list(call: InOrganization<ListProjectsInput>) -> Response {
    call.run(super::list_projects).await
}
