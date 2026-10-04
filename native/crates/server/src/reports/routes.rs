use super::schemas::*;
use crate::http::{App, InOrganization, Response};
use axum::{Router, routing::post};
use std::sync::Arc;

// Each call reads, with the report's filters as a JSON body.
pub fn routes() -> Router<Arc<App>> {
    Router::new().route("/report", post(report))
}
async fn report(call: InOrganization<ReportInput, true>) -> Response {
    call.run(super::get_report).await
}
