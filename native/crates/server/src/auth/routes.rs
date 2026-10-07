use crate::http::{App, AuthCall, Public, Response};
use crate::schemas::Empty;
use axum::{
    Router,
    routing::{get, post},
};
use std::sync::Arc;

// Calls that need no session (publicAuthRoutes).
pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/session", get(session))
        .route("/sign-in-methods", get(sign_in_methods))
        .route("/deployment", get(deployment))
        .route("/dev-users", get(dev_users))
}
async fn sign_in_methods(call: Public<Empty>) -> Response {
    call.with_config(super::sign_in_page::sign_in_methods).await
}
async fn deployment(call: Public<Empty>) -> Response {
    call.with_config(super::sign_in_page::get_deployment).await
}
async fn dev_users(call: Public<Empty>) -> Response {
    call.with_config(super::sign_in_page::get_dev_users).await
}
async fn session(call: Public<Empty>) -> Response {
    call.with_session(super::app_session::get_app_session).await
}

// Better Auth's own routes, under /api/auth.
pub fn better_auth_routes() -> Router<Arc<App>> {
    Router::new()
        .route("/api/auth/sign-in/email", post(sign_in))
        .route("/api/auth/sign-out", post(sign_out))
}
async fn sign_out(call: AuthCall) -> Response {
    call.sign_out().await
}
async fn sign_in(call: AuthCall) -> Response {
    call.sign_in().await
}
