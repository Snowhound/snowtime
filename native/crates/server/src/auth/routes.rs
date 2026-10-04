use crate::http::{App, Empty, Public, Response};
use axum::{Router, routing::post};
use std::sync::Arc;
pub fn routes() -> Router<Arc<App>> {
    Router::new().route("/api/auth/sign-in/email", post(sign_in))
}
async fn sign_in(call: Public<Empty, true>) -> Response {
    call.sign_in().await
}
