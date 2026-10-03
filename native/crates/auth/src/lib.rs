//! Email sign-in and the session check, as Better Auth 1.7.6 does them with this app's
//! options (src/server/auth/better-auth.server.ts): the same scrypt hashes, session rows,
//! and signed session cookie, so either backend accepts the other's sessions. Better Auth's
//! cookie cache (session_data) isn't ported; every check reads the session row.
pub mod cookie;
pub mod password;
pub mod session;

pub use session::{Credentials, SessionConfig, create_session, find_credentials, signed_in_user};
