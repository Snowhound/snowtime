use crate::http::{App, InOrganization, Response};
use crate::schemas::Empty;
use axum::{Router, routing::get};
use std::sync::Arc;

pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/teams", get(teams))
        .route("/members", get(members))
}
async fn teams(call: InOrganization<Empty>) -> Response {
    call.run(super::list_teams).await
}
async fn members(call: InOrganization<Empty>) -> Response {
    call.run(super::list_members).await
}
