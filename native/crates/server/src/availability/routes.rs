use crate::http::{App, Empty, Public, Response};
use axum::{Router, routing::get};
use std::sync::Arc;
pub fn routes() -> Router<Arc<App>> {
    Router::new().route("/availability", get(available))
}
async fn available(call: Public<Empty>) -> Response {
    call.run(|db, _| Ok(super::database_available(db))).await
}
