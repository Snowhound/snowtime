use crate::http::{App, AuthCall, Public, Response};
use crate::schemas::Empty;
use axum::{
    Router,
    routing::{get, post},
};
use std::sync::Arc;

// Calls that need no session (publicAuthRoutes): only the session itself is ported.
pub fn routes() -> Router<Arc<App>> {
    Router::new().route("/session", get(session))
}
async fn session(call: Public<Empty>) -> Response {
    call.with_session(super::app_session::get_app_session).await
}

// Better Auth's own routes, under /api/auth.
pub fn better_auth_routes() -> Router<Arc<App>> {
    Router::new().route("/api/auth/sign-in/email", post(sign_in))
}
async fn sign_in(call: AuthCall) -> Response {
    call.sign_in().await
}
