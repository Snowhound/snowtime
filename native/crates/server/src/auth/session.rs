//! The session row and its check (Better Auth's createSession, findSession, and
//! getSession), with this app's options: sessions last 30 days and renew daily while used.
use crate::Timestamp;
use rand::RngExt;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use super::cookie;

pub const EXPIRES_IN_S: i64 = 30 * 24 * 60 * 60;
const UPDATE_AGE_S: i64 = 24 * 60 * 60;

pub struct SessionConfig {
    pub secret: String,
    // With an https app URL, the cookie has the __Secure- prefix and the Secure attribute.
    pub secure: bool,
    // ALLOWED_LOGIN_DOMAINS, which `find_session_with_writer` applies.
    pub allowed_domains: Vec<String>,
}

impl SessionConfig {
    pub fn cookie_name(&self) -> &'static str {
        if self.secure {
            "__Secure-better-auth.session_token"
        } else {
            "better-auth.session_token"
        }
    }

    /// The Set-Cookie header for a new session's token.
    pub fn session_cookie(&self, token: &str) -> String {
        let value = cookie::sign(token, &self.secret);
        cookie::serialize(self.cookie_name(), &value, Some(EXPIRES_IN_S), self.secure)
    }
}

/// A request's live session (Better Auth's session row) and its user's address.
pub struct Session {
    pub user_id: String,
    pub email: String,
    pub created_at: Timestamp,
    pub active_organization_id: Option<String>,
}

/// The session of a request's Cookie header, or None. An expired session is deleted; one
/// used a day or more after it was last renewed is renewed for 30 days. On a read-only
/// connection, either fails; `find_session_with_writer` handles them.
///
/// It returns a session whose domain ALLOWED_LOGIN_DOMAINS no longer lists, as Better Auth's
/// getSessionFromCtx does, so Better Auth's routes can refuse it with 403 as the app's
/// loginDomainMiddleware does.
pub fn find_session(
    db: &Connection,
    config: &SessionConfig,
    cookie_header: Option<&str>,
    now: i64,
) -> rusqlite::Result<Option<Session>> {
    match find_session_using(db, config, cookie_header, now)? {
        Found::Session(session) => Ok(session),
        Found::NeedsWriter { .. } => Err(rusqlite::Error::InvalidQuery),
    }
}

/// The API's session check, as the app's getSession answers it: `find_session` on any
/// connection, with a session whose domain ALLOWED_LOGIN_DOMAINS doesn't list treated as
/// none. A read-only connection renews or deletes the session on the writer only if the
/// writer's gate has a free slot; otherwise a later request does it. A session due for
/// renewal stays valid for weeks, and an expired one is refused either way, so a busy
/// writer never holds up a read.
pub(crate) fn find_session_with_writer(
    db: &Connection,
    writer: &std::sync::Mutex<Connection>,
    gate: &crate::admission::Gate,
    config: &SessionConfig,
    cookie_header: Option<&str>,
    now: i64,
) -> rusqlite::Result<Option<Session>> {
    let session = find_any_session_with_writer(db, writer, gate, config, cookie_header, now)?;
    Ok(session.filter(|s| super::login_domains::allowed(&config.allowed_domains, &s.email)))
}

/// `find_session_with_writer` without the domain filter, for loginDomainMiddleware, which
/// refuses a session whose domain isn't listed.
pub(crate) fn find_any_session_with_writer(
    db: &Connection,
    writer: &std::sync::Mutex<Connection>,
    gate: &crate::admission::Gate,
    config: &SessionConfig,
    cookie_header: Option<&str>,
    now: i64,
) -> rusqlite::Result<Option<Session>> {
    Ok(match find_session_using(db, config, cookie_header, now)? {
        Found::Session(session) => session,
        Found::NeedsWriter { session, expired } => match gate.try_acquire() {
            Some(_permit) => {
                let writer = writer.lock().unwrap_or_else(|e| e.into_inner());
                // Another reader may have renewed the session since this one read it.
                find_session(&writer, config, cookie_header, now)?
            }
            None => (!expired).then_some(session),
        },
    })
}

enum Found {
    Session(Option<Session>),
    // Renewing or deleting the session needs the writer; `db` is read-only.
    NeedsWriter { session: Session, expired: bool },
}

fn find_session_using(
    db: &Connection,
    config: &SessionConfig,
    cookie_header: Option<&str>,
    now: i64,
) -> rusqlite::Result<Found> {
    let Some(cookie) = cookie_header.and_then(|h| cookie::find(h, config.cookie_name())) else {
        return Ok(Found::Session(None));
    };
    let Some(token) = cookie::verify(&cookie, &config.secret) else {
        return Ok(Found::Session(None));
    };
    let session = db
        .prepare_cached(
            "select session.user_id, session.expires_at, session.created_at,
                    session.active_organization_id, user.email
             from session join user on user.id = session.user_id where session.token = ?1",
        )?
        .query_row([token], |row| {
            Ok((
                Session {
                    user_id: row.get(0)?,
                    email: row.get(4)?,
                    created_at: row.get(2)?,
                    active_organization_id: row.get(3)?,
                },
                row.get::<_, i64>(1)?,
            ))
        })
        .optional()?;
    let Some((session, expires_at)) = session else {
        return Ok(Found::Session(None));
    };
    let expired = expires_at < now;
    let renew = expires_at - EXPIRES_IN_S * 1000 + UPDATE_AGE_S * 1000 <= now;
    if (expired || renew) && db.is_readonly("main")? {
        return Ok(Found::NeedsWriter { session, expired });
    }
    if expired {
        db.execute("delete from session where token = ?1", [token])?;
        return Ok(Found::Session(None));
    }
    if renew {
        db.execute(
            "update session set expires_at = ?1, updated_at = ?2 where token = ?3",
            params![now + EXPIRES_IN_S * 1000, now, token],
        )?;
    }
    Ok(Found::Session(Some(session)))
}

/// The signed-in user of a request's Cookie header, or None.
pub fn signed_in_user(
    db: &Connection,
    config: &SessionConfig,
    cookie_header: Option<&str>,
    now: i64,
) -> rusqlite::Result<Option<String>> {
    Ok(find_session(db, config, cookie_header, now)?.map(|s| s.user_id))
}

/// The user as Better Auth's sign-in returns it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub name: String,
    pub email: String,
    pub email_verified: bool,
    pub image: Option<String>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

pub struct Credentials {
    pub user: User,
    // The credential account's password hash, if it has one.
    pub password: Option<String>,
}

/// The user with this address, compared in lower case, and their password hash.
pub fn find_credentials(db: &Connection, email: &str) -> rusqlite::Result<Option<Credentials>> {
    db.prepare_cached(
        "select user.id, user.name, user.email, user.email_verified, user.image,
                user.created_at, user.updated_at, account.password
         from user left join account on account.user_id = user.id
           and account.provider_id = 'credential' and account.account_id = user.id
         where user.email = ?1",
    )?
    .query_row([email.to_lowercase()], |row| {
        Ok(Credentials {
            user: User {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                email_verified: row.get(3)?,
                image: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            },
            password: row.get(7)?,
        })
    })
    .optional()
}

/// Writes a session for the user and returns its token.
pub fn create_session(
    db: &Connection,
    user_id: &str,
    ip_address: &str,
    user_agent: &str,
    now: i64,
) -> rusqlite::Result<String> {
    let token = random_token();
    db.execute(
        "insert into session (id, user_id, token, expires_at, ip_address, user_agent,
                              created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            uuid_v7(now),
            user_id,
            token,
            now + EXPIRES_IN_S * 1000,
            ip_address,
            super::bounds::user_agent(user_agent),
            now
        ],
    )?;
    Ok(token)
}

// Better Auth's generateId(32): letters and digits.
fn random_token() -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::rng();
    (0..32)
        .map(|_| ALPHABET[rng.random_range(0..ALPHABET.len())] as char)
        .collect()
}

// The app's generateId, from the server's clock.
fn uuid_v7(now: i64) -> String {
    let at = uuid::Timestamp::from_unix(
        uuid::NoContext,
        now.div_euclid(1000) as u64,
        (now.rem_euclid(1000) * 1_000_000) as u32,
    );
    uuid::Uuid::new_v7(at).to_string()
}

#[cfg(test)]
mod input_bounds_tests {
    use super::*;
    #[test]
    fn sessions_store_at_most_512_user_agent_bytes() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("create table session(id text,user_id text,token text,expires_at integer,ip_address text,user_agent text,created_at integer,updated_at integer);").unwrap();
        let agent = format!("{}😀", "a".repeat(510));
        let token = create_session(&db, "user", "127.0.0.1", &agent, 0).unwrap();
        let stored: String = db
            .query_row(
                "select user_agent from session where token=?1",
                [token],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, "a".repeat(510));
    }
}
