//! Isolated question 5 experiment; the production routes do not mount this library.
mod bridge;
mod passkeys;
mod policy;
mod store;
#[cfg(test)]
mod tests;
mod transaction;

use better_auth_core::{schema::AuthSchema, wire::*};
pub use bridge::{handle, handle_with_policy};
pub use policy::Policy;
pub use store::LaneStore;
pub struct Schema;
impl AuthSchema for Schema {
    type User = UserView;
    type Session = LaneSession;
    type Account = AccountView;
    type Verification = VerificationView;
}

// Snowtime has no session.active column: a row is active until deleted or expired.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct LaneSession(SessionView);
impl std::ops::Deref for LaneSession {
    type Target = SessionView;
    fn deref(&self) -> &SessionView {
        &self.0
    }
}
impl better_auth_core::AuthSession for LaneSession {
    fn id(&self) -> std::borrow::Cow<'_, str> {
        better_auth_core::AuthSession::id(&self.0)
    }
    fn expires_at(&self) -> chrono::DateTime<chrono::Utc> {
        better_auth_core::AuthSession::expires_at(&self.0)
    }
    fn token(&self) -> &str {
        better_auth_core::AuthSession::token(&self.0)
    }
    fn created_at(&self) -> chrono::DateTime<chrono::Utc> {
        better_auth_core::AuthSession::created_at(&self.0)
    }
    fn updated_at(&self) -> chrono::DateTime<chrono::Utc> {
        better_auth_core::AuthSession::updated_at(&self.0)
    }
    fn ip_address(&self) -> Option<&str> {
        better_auth_core::AuthSession::ip_address(&self.0)
    }
    fn user_agent(&self) -> Option<&str> {
        better_auth_core::AuthSession::user_agent(&self.0)
    }
    fn user_id(&self) -> std::borrow::Cow<'_, str> {
        better_auth_core::AuthSession::user_id(&self.0)
    }
    fn impersonated_by(&self) -> Option<&str> {
        better_auth_core::AuthSession::impersonated_by(&self.0)
    }
    fn active_organization_id(&self) -> Option<&str> {
        better_auth_core::AuthSession::active_organization_id(&self.0)
    }
    fn active(&self) -> bool {
        true
    }
}
