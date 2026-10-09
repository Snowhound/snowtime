use super::*;
use crate::schemas::decode;
use serde_json::json;

// Keys the TypeScript server created through @better-auth/api-key 1.7.7, with the hashes the
// plugin stored for them.
const PLUGIN_KEYS: [(&str, &str); 2] = [
    (
        "snow_zatQeQgvNrmdaZqFJCTnEkxbEfVLlKPEqHNUmXMoZBiqSbPLndtalcsLtxdTxgUj",
        "K3tN2UlX6Q5cA-taVHfVwrUziAsCb1fBz2LFftr_nSo",
    ),
    (
        "snow_pkcrEaRKTtUwDgFsWdeypABzcZKxgSXGQoTOplrLPedACQBplkTtOiIipjhBDKwJ",
        "aG6l2wStfXQGh1OIOEJrE9l2eGz6xNu8xqHIRwGXY9w",
    ),
];
const NOW: i64 = 1_790_000_000_000;
const DOMAINS: &[String] = &[];

fn database() -> Connection {
    let mut db = Connection::open_in_memory().unwrap();
    crate::migrations::migrate(
        &mut db,
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../drizzle"),
    )
    .unwrap();
    db.execute_batch("insert into user (id, name, email, email_verified, created_at, updated_at) values ('alice', 'Alice', 'alice@example.com', 1, 0, 0), ('bob', 'Bob', 'bob@other.example', 1, 0, 0)").unwrap();
    db
}

// A key row as the plugin writes one, under a known key.
fn insert(db: &Connection, id: &str, user: &str, key: &str, permissions: &str) {
    db.execute(
        "insert into api_key (id, config_id, name, reference_id, prefix, key, enabled, rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count, created_at, updated_at, permissions, metadata) values (?1, 'default', ?1, ?2, 'snow_', ?3, 1, 0, 86400000, 10, 0, ?4, ?4, ?5, 'null')",
        rusqlite::params![id, user, hash_key(key), NOW - 1000, permissions],
    )
    .unwrap();
}
const READ: &str = r#"{"api":["read"]}"#;
const WRITE: &str = r#"{"api":["read","write"]}"#;

fn check(db: &Connection, key: &str, write: bool) -> Result<(String, Option<LastUse>)> {
    key_user(db, key, write, &MemoryStore::new(true), DOMAINS, NOW)
}
fn refusal_of(result: Result<(String, Option<LastUse>)>) -> (u16, &'static str, &'static str) {
    match result {
        Err(Error::Auth {
            status,
            code,
            message,
        }) => (status, code, message),
        other => panic!("expected a key refusal, got {other:?}"),
    }
}

#[test]
fn hashes_keys_as_the_plugin_does() {
    for (key, stored) in PLUGIN_KEYS {
        assert_eq!(hash_key(key), stored);
    }
}

#[test]
fn reads_the_bearer_key_as_the_api_does() {
    fn key(values: &[&[u8]]) -> Option<String> {
        let mut headers = HeaderMap::new();
        for value in values {
            headers.append(
                header::AUTHORIZATION,
                axum::http::HeaderValue::from_bytes(value).unwrap(),
            );
        }
        bearer_key(&headers)
    }
    assert_eq!(key(&[b"Bearer snow_abc"]).as_deref(), Some("snow_abc"));
    assert_eq!(
        key(&[b"bEaReR \t snow_abc \t"]).as_deref(),
        Some("snow_abc")
    );
    // A no-break space is JavaScript whitespace; the key is the run of other characters.
    assert_eq!(key(&[b"Bearer\xa0snow_abc"]).as_deref(), Some("snow_abc"));
    assert_eq!(key(&[b"Bearer s\xe9"]).as_deref(), Some("s\u{e9}"));
    for refused in [
        &[b"Bearersnow_abc".as_slice()][..],
        &[b"Bearer "],
        &[b"Bearer a b"],
        &[b"Basic snow_abc"],
        &[b"Bearer a", b"Bearer b"],
        &[],
    ] {
        assert_eq!(key(refused), None, "{refused:?}");
    }
}

#[test]
fn generates_prefixed_keys_of_64_letters() {
    let key = generate_key();
    let letters = key.strip_prefix("snow_").unwrap();
    assert_eq!(letters.len(), 64);
    assert!(letters.bytes().all(|b| b.is_ascii_alphabetic()));
    assert_ne!(generate_key(), key);
}

#[test]
fn creates_the_row_the_plugin_creates() {
    let db = database();
    let input = |lifetime: &str, access: &str| {
        decode::<CreateApiKeyInput>(
            json!({"name": "  Laptop  ", "lifetime": lifetime, "access": access}),
        )
        .unwrap()
    };
    let created = create_api_key(&db, "alice", input("90d", "read")).unwrap();
    assert!(created.key.starts_with("snow_"));
    // Every column but the generated id, hash, and times, as the plugin wrote it (row from
    // the TypeScript server).
    let row: serde_json::Value = db
        .query_row(
            "select json_object('config_id', config_id, 'name', name, 'start', start, 'reference_id', reference_id, 'prefix', prefix, 'key', key, 'refill_interval', refill_interval, 'refill_amount', refill_amount, 'last_refill_at', last_refill_at, 'enabled', enabled, 'rate_limit_enabled', rate_limit_enabled, 'rate_limit_time_window', rate_limit_time_window, 'rate_limit_max', rate_limit_max, 'request_count', request_count, 'remaining', remaining, 'last_request', last_request, 'lifetime', expires_at - created_at, 'updated', updated_at - created_at, 'permissions', permissions, 'metadata', metadata, 'metadata_type', typeof(metadata)) from api_key where id = ?1",
            [&created.id],
            |row| Ok(serde_json::from_str(&row.get::<_, String>(0)?).unwrap()),
        )
        .unwrap();
    assert_eq!(
        row,
        json!({"config_id": "default", "name": "Laptop", "start": null, "reference_id": "alice", "prefix": "snow_", "key": hash_key(&created.key), "refill_interval": null, "refill_amount": null, "last_refill_at": null, "enabled": 1, "rate_limit_enabled": 0, "rate_limit_time_window": 86_400_000, "rate_limit_max": 10, "request_count": 0, "remaining": null, "last_request": null, "lifetime": 90 * DAY_SECONDS * 1000, "updated": 0, "permissions": READ, "metadata": "null", "metadata_type": "text"})
    );
    let never = create_api_key(&db, "alice", input("none", "write")).unwrap();
    let (expires, permissions): (Option<i64>, String) = db
        .query_row(
            "select expires_at, permissions from api_key where id = ?1",
            [&never.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((expires, permissions.as_str()), (None, WRITE));
}

#[test]
fn refuses_names_and_lifetimes_the_schema_refuses() {
    let refused = |input: serde_json::Value| match decode::<CreateApiKeyInput>(input) {
        Err(Error::Invalid(message)) => message,
        _ => panic!("expected a validation refusal"),
    };
    assert_eq!(
        refused(json!({"name": " \u{a0} ", "lifetime": "30d", "access": "read"})),
        "Enter a name."
    );
    assert_eq!(
        refused(json!({"name": "x".repeat(33), "lifetime": "30d", "access": "read"})),
        "Use at most 32 characters."
    );
    assert_eq!(
        refused(json!({"name": "Laptop", "lifetime": "2y", "access": "read"})),
        "Invalid type: Expected (\"30d\" | \"90d\" | \"1y\" | \"none\") but received \"2y\""
    );
    let padded = decode::<CreateApiKeyInput>(
        json!({"name": format!(" {} ", "é".repeat(32)), "lifetime": "1y", "access": "write"}),
    )
    .unwrap();
    assert_eq!(padded.name, "é".repeat(32));
}

#[test]
fn caps_keys_per_user_counting_expired_ones() {
    let db = database();
    for i in 0..API_KEYS_PER_USER {
        insert(&db, &format!("k{i}"), "alice", &format!("key{i}"), READ);
    }
    db.execute("update api_key set expires_at = 1", []).unwrap();
    let input = decode(json!({"name": "One more", "lifetime": "30d", "access": "read"})).unwrap();
    assert!(matches!(
        create_api_key(&db, "alice", input),
        Err(Error::App(crate::AppError {
            code: Code::LimitReached,
            key: Key::ApiKeyLimit
        }))
    ));
    let input = decode(json!({"name": "Bob's", "lifetime": "30d", "access": "read"})).unwrap();
    assert!(create_api_key(&db, "bob", input).is_ok());
}

#[test]
fn deletes_expired_keys_at_most_every_ten_seconds() {
    let db = database();
    insert(&db, "past", "alice", "a", READ);
    insert(&db, "now", "alice", "b", READ);
    insert(&db, "never", "alice", "c", READ);
    db.execute_batch(&format!(
        "update api_key set expires_at = {} where id = 'past'; update api_key set expires_at = {NOW} where id = 'now'",
        NOW - 1
    ))
    .unwrap();
    let ids = || {
        db.prepare("select id from api_key order by id")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    let last_checked = Mutex::new(None);
    delete_expired(&db, NOW, &last_checked);
    assert_eq!(ids(), ["never", "now"]);
    delete_expired(&db, NOW + 9_999, &last_checked);
    assert_eq!(ids(), ["never", "now"]);
    delete_expired(&db, NOW + 10_000, &last_checked);
    assert_eq!(ids(), ["never"]);
}

#[test]
fn lists_own_keys_newest_first_and_revokes_only_own_keys() {
    let db = database();
    insert(&db, "old", "alice", "a", READ);
    insert(&db, "new", "alice", "b", WRITE);
    insert(&db, "bobs", "bob", "c", WRITE);
    db.execute(
        "update api_key set created_at = created_at + 1 where id = 'new'",
        [],
    )
    .unwrap();
    // listApiKeys's bytes, its field order included.
    let listed =
        serde_json::to_string(&list_api_keys(&db, "alice", crate::schemas::Empty {}).unwrap())
            .unwrap();
    assert_eq!(
        listed,
        concat!(
            r#"[{"id":"new","createdAt":"2026-09-21T14:13:19.001Z","expiresAt":null,"lastUsedAt":null,"name":"new","access":"write"},"#,
            r#"{"id":"old","createdAt":"2026-09-21T14:13:19.000Z","expiresAt":null,"lastUsedAt":null,"name":"old","access":"read"}]"#
        )
    );
    let revoke = |user: &str, id: &str| {
        revoke_api_key(&db, user, RevokeApiKeyInput { id: id.into() }).map(|r| r.id)
    };
    assert!(matches!(
        revoke("alice", "bobs"),
        Err(Error::App(crate::AppError {
            code: Code::NotFound,
            key: Key::ApiKeyNotFound
        }))
    ));
    assert_eq!(revoke("alice", "old").unwrap(), "old");
    assert!(revoke("alice", "old").is_err());
}

#[test]
fn signs_in_the_keys_user_and_refuses_each_bad_key() {
    let db = database();
    insert(&db, "reader", "alice", "snow_read", READ);
    insert(&db, "writer", "alice", "snow_write", WRITE);
    insert(&db, "bobs", "bob", "snow_bob", WRITE);
    assert_eq!(check(&db, "snow_read", false).unwrap().0, "alice");
    assert_eq!(check(&db, "snow_write", true).unwrap().0, "alice");

    let invalid = (401, "UNAUTHENTICATED", "Invalid API key.");
    assert_eq!(refusal_of(check(&db, "snow_unknown", false)), invalid);
    db.execute("update api_key set enabled = 0 where id = 'reader'", [])
        .unwrap();
    assert_eq!(refusal_of(check(&db, "snow_read", false)), invalid);
    db.execute("update api_key set enabled = 1 where id = 'reader'", [])
        .unwrap();

    // Expired from the moment it ends.
    db.execute(
        "update api_key set expires_at = ?1 where id = 'reader'",
        [NOW + 1],
    )
    .unwrap();
    assert!(check(&db, "snow_read", false).is_ok());
    db.execute(
        "update api_key set expires_at = ?1 where id = 'reader'",
        [NOW],
    )
    .unwrap();
    assert_eq!(
        refusal_of(check(&db, "snow_read", false)),
        (401, "UNAUTHENTICATED", "API key expired.")
    );
    db.execute(
        "update api_key set expires_at = null where id = 'reader'",
        [],
    )
    .unwrap();

    assert_eq!(
        refusal_of(check(&db, "snow_read", true)),
        (403, "FORBIDDEN", "API key is read-only.")
    );

    let domains = ["example.com".to_owned()];
    let store = MemoryStore::new(true);
    assert!(key_user(&db, "snow_write", true, &store, &domains, NOW).is_ok());
    assert_eq!(
        refusal_of(key_user(&db, "snow_bob", false, &store, &domains, NOW)),
        (401, "UNAUTHENTICATED", "Email domain not allowed.")
    );
}

#[test]
fn counts_each_key_and_a_keys_writes_against_the_users_write_rate() {
    let db = database();
    insert(&db, "reader", "alice", "snow_read", READ);
    insert(&db, "writer", "alice", "snow_write", WRITE);
    let store = MemoryStore::new(true);
    let run = |key: &str, write: bool, now: i64| key_user(&db, key, write, &store, DOMAINS, now);
    for _ in 0..API_KEY_REQUESTS.max {
        assert!(run("snow_read", false, NOW).is_ok());
    }
    assert_eq!(
        refusal_of(run("snow_read", false, NOW)),
        (429, "RATE_LIMITED", "Too many requests.")
    );
    // Another key has its own count, and the window ends after a minute.
    assert!(run("snow_write", false, NOW).is_ok());
    assert!(run("snow_read", false, NOW + 60_000).is_ok());

    // The session's write rate: a key's write is refused once the user's writes reach it.
    for _ in 0..WRITES_PER_USER.max {
        assert!(store.consume("write:alice", WRITES_PER_USER, NOW));
    }
    assert!(matches!(
        run("snow_write", true, NOW),
        Err(Error::App(crate::AppError {
            code: Code::RateLimited,
            key: Key::RateLimited
        }))
    ));
    assert!(run("snow_write", false, NOW).is_ok());
}

#[test]
fn saves_the_last_use_at_most_once_a_minute() {
    let db = database();
    insert(&db, "reader", "alice", "snow_read", READ);
    let last_use = |now: i64| {
        key_user(
            &db,
            "snow_read",
            false,
            &MemoryStore::new(true),
            DOMAINS,
            now,
        )
        .unwrap()
        .1
    };
    let due = last_use(NOW).unwrap();
    assert_eq!(
        due,
        LastUse {
            id: "reader".into(),
            at: NOW
        }
    );
    save_last_use(&db, &due);
    let saved: i64 = db
        .query_row("select last_request from api_key", [], |r| r.get(0))
        .unwrap();
    assert_eq!(saved, NOW);
    assert_eq!(last_use(NOW + 59_999), None);
    assert!(last_use(NOW + 60_000).is_some());
}

#[test]
fn a_failed_last_use_save_is_only_logged() {
    let db = database();
    db.execute_batch("create trigger refuse before update on api_key begin select raise(abort, 'read-only'); end")
        .unwrap();
    save_last_use(
        &db,
        &LastUse {
            id: "reader".into(),
            at: NOW,
        },
    );
}
