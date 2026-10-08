//! Authentication and the session check, as Better Auth 1.7.7 does them with this app's
//! options (src/server/auth/better-auth.server.ts): the same scrypt hashes, session rows,
//! and signed session cookie, so either backend accepts the other's sessions. Better Auth's
//! cookie cache (session_data) isn't ported; every check reads the session row.
pub mod app_session;
pub mod cookie;
pub mod password;
pub mod schemas;
pub mod session;

pub use session::{Credentials, SessionConfig, create_session, find_credentials, signed_in_user};
pub(crate) use sign_in::FetchHeaders;

mod acceptance;
mod invitations;
pub(crate) mod oauth;
mod organization;
pub(crate) mod passkeys;
pub mod routes;
mod sign_in;
mod sign_in_page;
mod sign_out;

#[cfg(feature = "auth-spike")]
pub mod spike;
