use super::schemas::*;
use crate::http::{App, AsUser, AuthCall, InOrganization, Public, Response};
use crate::schemas::Empty;
use axum::{
    Router,
    routing::{get, patch, post},
};
use std::sync::Arc;

// Calls that need no session (publicAuthRoutes).
pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/session", get(session))
        .route("/sign-in-methods", get(sign_in_methods))
        .route("/deployment", get(deployment))
        .route("/dev-users", get(dev_users))
        .route("/invitations/{id}", get(invitation))
        .route("/invitations/{id}/accept", post(accept))
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
async fn invitation(call: Public<GetInvitationInput>) -> Response {
    call.run(super::invitations::invitation_preview).await
}
pub fn organization_routes() -> Router<Arc<App>> {
    Router::new()
        .route("/invitations", get(invitations).post(invite))
        .route("/issue-links", patch(issue_links))
}
async fn invitations(call: InOrganization<Empty>) -> Response {
    call.run(super::invitations::list_invitations).await
}
async fn invite(call: InOrganization<InviteMemberInput>) -> Response {
    call.with_auth(super::invitations::invite_member).await
}
async fn issue_links(call: InOrganization<UpdateIssueLinksInput>) -> Response {
    call.run(super::organization::update_issue_links).await
}

// Better Auth's own routes, under /api/auth.
pub fn better_auth_routes() -> Router<Arc<App>> {
    Router::new()
        .route("/api/auth/organization/leave", post(leave))
        .route("/api/auth/update-user", post(profile))
        .route("/api/auth/organization/set-active", post(set_active))
        .route("/api/auth/organization/check-slug", post(check_slug))
        .route("/api/auth/organization/create", post(create))
        .route("/api/auth/organization/update", post(update))
        .route("/api/auth/organization/update-member-role", post(role))
        .route("/api/auth/organization/remove-member", post(remove))
        .route("/api/auth/organization/cancel-invitation", post(cancel))
        .route("/api/auth/sign-in/social", post(social))
        .route("/api/auth/link-social", post(link_social))
        .route("/api/auth/list-accounts", get(accounts))
        .route("/api/auth/unlink-account", post(unlink))
        .route("/api/auth/callback/{id}", get(callback).post(callback))
        .route(
            "/api/auth/passkey/generate-register-options",
            get(passkey_register_options),
        )
        .route(
            "/api/auth/passkey/generate-authenticate-options",
            get(passkey_authenticate_options),
        )
        .route(
            "/api/auth/passkey/verify-registration",
            post(passkey_register),
        )
        .route(
            "/api/auth/passkey/verify-authentication",
            post(passkey_authenticate),
        )
        .route("/api/auth/passkey/list-user-passkeys", get(passkey_list))
        .route("/api/auth/passkey/delete-passkey", post(passkey_delete))
        .route("/api/auth/sign-in/email", post(sign_in))
        .route("/api/auth/sign-out", post(sign_out))
        .route("/api/auth/error", get(error_page))
        .route(
            "/api/auth/organization/accept-invitation",
            post(auth_accept),
        )
}
async fn sign_out(call: AuthCall) -> Response {
    call.sign_out().await
}
async fn sign_in(call: AuthCall) -> Response {
    call.sign_in().await
}
async fn error_page(call: AuthCall) -> axum::response::Response {
    call.error_page().await
}

async fn accept(call: AsUser<GetInvitationInput>) -> Response {
    call.with_auth(super::acceptance::accept_invitation).await
}
async fn auth_accept(call: AuthCall) -> Response {
    call.accept_invitation().await
}

async fn passkey_register_options(call: AuthCall) -> Response {
    call.passkey(super::passkeys::Action::RegisterOptions).await
}

async fn passkey_authenticate_options(call: AuthCall) -> Response {
    call.passkey(super::passkeys::Action::AuthenticateOptions)
        .await
}

async fn passkey_register(call: AuthCall) -> Response {
    call.passkey(super::passkeys::Action::Register).await
}

async fn passkey_authenticate(call: AuthCall) -> Response {
    call.passkey(super::passkeys::Action::Authenticate).await
}

async fn passkey_list(call: AuthCall) -> Response {
    call.passkey(super::passkeys::Action::List).await
}

async fn passkey_delete(call: AuthCall) -> Response {
    call.passkey(super::passkeys::Action::Delete).await
}

async fn social(call: AuthCall) -> axum::response::Response {
    call.oauth(super::oauth::Action::SignIn).await
}
async fn link_social(call: AuthCall) -> axum::response::Response {
    call.oauth(super::oauth::Action::Link).await
}
async fn accounts(call: AuthCall) -> axum::response::Response {
    call.oauth(super::oauth::Action::List).await
}
async fn unlink(call: AuthCall) -> axum::response::Response {
    call.oauth(super::oauth::Action::Unlink).await
}
async fn callback(call: AuthCall) -> axum::response::Response {
    call.oauth(super::oauth::Action::Callback).await
}

async fn profile(call: AuthCall) -> Response {
    call.auth_write(super::writes::Action::Profile).await
}

async fn set_active(call: AuthCall) -> Response {
    call.auth_write(super::writes::Action::SetActive).await
}

async fn check_slug(call: AuthCall) -> Response {
    call.auth_write(super::writes::Action::CheckSlug).await
}

async fn create(call: AuthCall) -> Response {
    call.auth_write(super::writes::Action::Create).await
}

async fn update(call: AuthCall) -> Response {
    call.auth_write(super::writes::Action::Update).await
}

async fn role(call: AuthCall) -> Response {
    call.auth_write(super::writes::Action::Role).await
}

async fn remove(call: AuthCall) -> Response {
    call.auth_write(super::writes::Action::Remove).await
}

async fn cancel(call: AuthCall) -> Response {
    call.auth_write(super::writes::Action::Cancel).await
}

async fn leave(call: AuthCall) -> Response {
    call.auth_write(super::writes::Action::Leave).await
}
