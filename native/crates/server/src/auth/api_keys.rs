//! Personal API keys (src/server/auth/api-keys.server.ts): the rules Settings calls, keys
//! created as @better-auth/api-key 1.7.7 creates them with the app's options, and the check
//! that signs a JSON API request in with a key (docs/architecture/auth.md, "API keys"). Either
//! backend accepts the other's keys.
use super::login_domains;
use super::schemas::{ApiKey, CreateApiKeyInput, CreatedApiKey, RevokeApiKeyInput, RevokedApiKey};
use crate::limits::API_KEYS_PER_USER;
use crate::rate_limit::{API_KEY_REQUESTS, MemoryStore, WRITES_PER_USER};
use crate::schemas::{Timestamp, js_whitespace};
use crate::{Code, Error, Key, Result, clock, refuse};
use axum::http::{HeaderMap, header};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngExt;
use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

const PREFIX: &str = "snow_";
const DAY_SECONDS: i64 = 24 * 60 * 60;
// How often a key's last use is saved: Settings shows it, and no check depends on it.
const LAST_USE_PRECISION_MS: i64 = 60_000;

// The key in `Authorization: Bearer <key>`, or None when the request has none: the pattern
// /^Bearer\s+(\S+)\s*$/i over the header as fetch's Headers.get gives it, repeated fields
// joined with ", " and each byte one Latin-1 character.
pub(crate) fn bearer_key(headers: &HeaderMap) -> Option<String> {
    let mut value = String::new();
    for (i, field) in headers.get_all(header::AUTHORIZATION).iter().enumerate() {
        if i > 0 {
            value.push_str(", ");
        }
        value.extend(field.as_bytes().iter().map(|&b| char::from(b)));
    }
    let rest = value
        .get(..6)
        .filter(|scheme| scheme.eq_ignore_ascii_case("bearer"))
        .map(|_| &value[6..])?;
    let key = rest.trim_start_matches(js_whitespace);
    if key.len() == rest.len() {
        return None;
    }
    let (key, tail) = key.split_at(key.find(js_whitespace).unwrap_or(key.len()));
    (!key.is_empty() && tail.chars().all(js_whitespace)).then(|| key.to_owned())
}

/// The hash the plugin stores for a key: SHA-256 as unpadded base64url (its defaultKeyHasher).
pub(crate) fn hash_key(key: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(key.as_bytes()))
}

// The plugin's defaultKeyGenerator: the prefix and 64 letters, a-z and A-Z, uniformly.
fn generate_key() -> String {
    const LETTERS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut rng = rand::rng();
    let mut key = String::from(PREFIX);
    key.extend((0..64).map(|_| LETTERS[rng.random_range(0..LETTERS.len())] as char));
    key
}

// The plugin's permissions, `{"api":[...]}`, with `write` implying `read`. Rows hold what a
// server wrote; anything unreadable counts as read, the least access.
fn access_of(permissions: Option<&str>) -> &'static str {
    let api = permissions
        .and_then(|p| serde_json::from_str::<serde_json::Value>(p).ok())
        .and_then(|p| p.get("api").cloned());
    let write = match api {
        Some(serde_json::Value::Array(scopes)) => scopes.iter().any(|s| s == "write"),
        // Array and string share JavaScript's includes.
        Some(serde_json::Value::String(scopes)) => scopes.contains("write"),
        _ => false,
    };
    if write { "write" } else { "read" }
}

/// The user's keys, newest first, without their hashes.
pub fn list_api_keys(
    db: &Connection,
    user_id: &str,
    _: crate::schemas::Empty,
) -> Result<Vec<ApiKey>> {
    Ok(crate::sql!(
        "select id, name, permissions, created_at, expires_at, last_request from api_key where api_key.reference_id = ",
        user_id,
        " order by api_key.created_at desc"
    )
    .query(db, |row| {
        Ok(ApiKey {
            id: row.get(0)?,
            name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            access: access_of(row.get::<_, Option<String>>(2)?.as_deref()),
            created_at: row.get(3)?,
            expires_at: row.get(4)?,
            last_used_at: row.get(5)?,
        })
    })?)
}

/// Creates a key and returns it, the only time it appears; the row keeps its hash.
pub fn create_api_key(
    db: &Connection,
    user_id: &str,
    input: CreateApiKeyInput,
) -> Result<CreatedApiKey> {
    let total: i64 = crate::sql!(
        "select count(*) from api_key where api_key.reference_id = ",
        user_id
    )
    .query_row(db, |row| row.get(0))?;
    if total >= API_KEYS_PER_USER {
        return refuse(Code::LimitReached, Key::ApiKeyLimit);
    }
    let now = clock::now();
    let expires_in = match input.lifetime.as_str() {
        "30d" => Some(30 * DAY_SECONDS),
        "90d" => Some(90 * DAY_SECONDS),
        "1y" => Some(365 * DAY_SECONDS),
        _ => None,
    };
    let permissions = if input.access == "write" {
        r#"{"api":["read","write"]}"#
    } else {
        r#"{"api":["read"]}"#
    };
    static LAST_CHECKED: Mutex<Option<i64>> = Mutex::new(None);
    delete_expired(db, now, &LAST_CHECKED);
    let id = super::session::uuid_v7(now);
    let key = generate_key();
    // The plugin's row with the app's options: no starting characters, its own rate limit off
    // with its defaults of 10 a day stored, no refill or remaining count, and metadata as its
    // schema stores a missing value, JSON-encoded: the text 'null'.
    crate::sql!(
        "insert into api_key (id, config_id, name, start, reference_id, prefix, key, refill_interval, refill_amount, last_refill_at, enabled, rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count, remaining, last_request, expires_at, created_at, updated_at, permissions, metadata) values (",
        &id, ", 'default', ", &input.name, ", null, ", user_id, ", ", PREFIX, ", ", hash_key(&key),
        ", null, null, null, 1, 0, 86400000, 10, 0, null, null, ",
        expires_in.map(|seconds| now + seconds * 1000), ", ", now, ", ", now, ", ", permissions,
        ", 'null')"
    )
    .execute(db)?;
    Ok(CreatedApiKey { id, key })
}

// The plugin's deleteAllExpiredApiKeys, which creating a key starts: at most once in 10
// seconds per process, and a failure is only logged.
fn delete_expired(db: &Connection, now: i64, last_checked: &Mutex<Option<i64>>) {
    {
        let mut last = last_checked.lock().unwrap_or_else(|e| e.into_inner());
        if last.is_some_and(|last| now - last < 10_000) {
            return;
        }
        *last = Some(now);
    }
    let deleted = crate::sql!(
        "delete from api_key where (api_key.expires_at < ",
        now,
        " and api_key.expires_at is not null)"
    )
    .execute(db);
    if let Err(error) = deleted {
        eprintln!("[api-key] Failed to delete expired API keys: {error}");
    }
}

/// Deletes one of the user's own keys.
pub fn revoke_api_key(
    db: &Connection,
    user_id: &str,
    input: RevokeApiKeyInput,
) -> Result<RevokedApiKey> {
    let deleted = crate::sql!(
        "delete from api_key where (api_key.id = ",
        &input.id,
        " and api_key.reference_id = ",
        user_id,
        ") returning id"
    )
    .query(db, |row| row.get::<_, String>(0))?;
    if deleted.is_empty() {
        return refuse(Code::NotFound, Key::ApiKeyNotFound);
    }
    Ok(RevokedApiKey { id: input.id })
}

// Refusals only a key's requests get, with English messages and no key.
fn refusal(status: u16, code: &'static str, message: &'static str) -> Error {
    Error::Auth {
        status,
        code,
        message,
    }
}
pub(crate) fn not_allowed() -> Error {
    refusal(403, "FORBIDDEN", "API keys cannot make this call.")
}

/// The key's last use, due to be saved.
#[derive(Debug, PartialEq)]
pub(crate) struct LastUse {
    id: String,
    at: i64,
}

/// The user a key signs in, from one read of the key and its user (keyChecker). A write
/// also counts toward the user's write rate, which the session's calls share. `LastUse` is
/// set when the saved last use is missing or a minute old.
pub(crate) fn key_user(
    db: &Connection,
    key: &str,
    write: bool,
    rate_limits: &MemoryStore,
    allowed_domains: &[String],
    now: i64,
) -> Result<(String, Option<LastUse>)> {
    let found = db
        .prepare_cached(
            "select api_key.id, api_key.reference_id, user.email, api_key.enabled, api_key.expires_at, api_key.permissions, api_key.last_request
             from api_key inner join user on user.id = api_key.reference_id where api_key.key = ?1",
        )?
        .query_row([hash_key(key)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)? != 0,
                row.get::<_, Option<Timestamp>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<Timestamp>>(6)?,
            ))
        })
        .optional()?;
    let Some((id, user_id, email, true, expires_at, permissions, last_used_at)) = found else {
        return Err(refusal(401, "UNAUTHENTICATED", "Invalid API key."));
    };
    if expires_at.is_some_and(|at| at.0 <= now) {
        return Err(refusal(401, "UNAUTHENTICATED", "API key expired."));
    }
    if write && access_of(permissions.as_deref()) != "write" {
        return Err(refusal(403, "FORBIDDEN", "API key is read-only."));
    }
    // A key outlives neither its domain's removal from ALLOWED_LOGIN_DOMAINS nor a changed
    // address.
    if !login_domains::allowed(allowed_domains, &email) {
        return Err(refusal(401, "UNAUTHENTICATED", "Email domain not allowed."));
    }
    // Both count, as Promise.all consumes both, before either refuses.
    let per_key = rate_limits.consume(&format!("api-key:{id}"), API_KEY_REQUESTS, now);
    let per_user = !write || rate_limits.consume(&format!("write:{user_id}"), WRITES_PER_USER, now);
    if !per_key {
        return Err(refusal(429, "RATE_LIMITED", "Too many requests."));
    }
    if !per_user {
        return refuse(Code::RateLimited, Key::RateLimited);
    }
    let due = last_used_at.is_none_or(|at| now - at.0 >= LAST_USE_PRECISION_MS);
    Ok((user_id, due.then_some(LastUse { id, at: now })))
}

/// Saves a key's last use. A failure only leaves Settings showing an older one, so it is
/// logged and never fails the call.
pub(crate) fn save_last_use(db: &Connection, last_use: &LastUse) {
    let saved = crate::sql!(
        "update api_key set last_request = ",
        last_use.at,
        " where api_key.id = ",
        &last_use.id
    )
    .execute(db);
    if let Err(error) = saved {
        eprintln!("[api-key] Saving an API key's last use failed: {error}");
    }
}

#[cfg(test)]
mod tests;
