//! Bounded read-only WAL connections; a lease returns its connection on every exit.
use rusqlite::{Connection, OpenFlags};
use std::ops::Deref;
use std::sync::{Condvar, Mutex};

pub(crate) struct Readers {
    idle: Mutex<Vec<Connection>>,
    available: Condvar,
}
impl Readers {
    pub fn open(path: &str, count: usize) -> rusqlite::Result<Self> {
        let mut idle = Vec::with_capacity(count);
        for _ in 0..count {
            let db = Connection::open_with_flags(
                path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )?;
            db.busy_timeout(std::time::Duration::from_secs(5))?;
            db.pragma_update(None, "query_only", true)?;
            db.pragma_update(None, "cache_size", -2048)?;
            db.set_prepared_statement_cache_capacity(64);
            crate::timing::install(&db);
            idle.push(db);
        }
        Ok(Self {
            idle: Mutex::new(idle),
            available: Condvar::new(),
        })
    }
    #[cfg(feature = "bench")]
    pub fn stats(&self) -> serde_json::Value {
        match self.idle.try_lock() {
            Ok(idle) => {
                serde_json::json!({ "idle": idle.len(), "connections": idle.iter().map(crate::bench::sqlite).collect::<Vec<_>>() })
            }
            Err(_) => serde_json::Value::Null,
        }
    }
    pub fn acquire(&self) -> ReadLease<'_> {
        let mut idle = self.idle.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            if let Some(db) = idle.pop() {
                return ReadLease {
                    pool: self,
                    db: Some(db),
                };
            }
            idle = self.available.wait(idle).unwrap_or_else(|e| e.into_inner());
        }
    }
}
pub(crate) struct ReadLease<'a> {
    pool: &'a Readers,
    db: Option<Connection>,
}
impl Deref for ReadLease<'_> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        self.db.as_ref().unwrap()
    }
}
impl Drop for ReadLease<'_> {
    fn drop(&mut self) {
        self.pool
            .idle
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(self.db.take().unwrap());
        self.pool.available.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admission::Gate;
    use crate::auth::session::{EXPIRES_IN_S, SessionConfig, find_session_with_writer};
    use std::time::Duration;

    #[test]
    fn session_maintenance_on_the_writer_does_not_relock_it() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("create table user (id text); insert into user values ('alice');
            create table session (user_id text, token text, expires_at integer, created_at integer, updated_at integer, active_organization_id text);").unwrap();
        let now = 1_800_000_000_000i64;
        db.execute(
            "insert into session values ('alice', 'token', ?, ?, ?, null)",
            [
                now + EXPIRES_IN_S * 1000 - 2 * 86_400_000,
                now - 2 * 86_400_000,
                now - 2 * 86_400_000,
            ],
        )
        .unwrap();
        let writer = std::sync::Arc::new(Mutex::new(db));
        let (sent, received) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let config = SessionConfig {
                secret: "test-secret".into(),
                secure: false,
            };
            let cookie = config.session_cookie("token");
            let gate = Gate::new(1, Duration::from_secs(1));
            let db = writer.lock().unwrap();
            let session =
                find_session_with_writer(&db, &writer, &gate, &config, Some(&cookie), now).unwrap();
            assert!(session.is_some());
            assert!(
                find_session_with_writer(
                    &db,
                    &writer,
                    &gate,
                    &config,
                    Some(&cookie),
                    now + 31 * 86_400_000
                )
                .unwrap()
                .is_none()
            );
            sent.send(()).unwrap();
        });
        received
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("maintenance must reuse an already-owned writer");
        worker.join().unwrap();
    }

    #[test]
    fn readers_see_committed_writes_and_session_maintenance_uses_writer() {
        let path = std::env::temp_dir().join(format!("snowtime-pool-{}.db", uuid::Uuid::now_v7()));
        let writer = Connection::open(&path).unwrap();
        writer.pragma_update(None, "journal_mode", "WAL").unwrap();
        writer.execute_batch("create table user (id text); insert into user values ('alice');
            create table session (user_id text, token text, expires_at integer, created_at integer, updated_at integer, active_organization_id text);").unwrap();
        let now = 1_800_000_000_000i64;
        writer
            .execute(
                "insert into session values ('alice', 'token', ?, ?, ?, null)",
                [
                    now + EXPIRES_IN_S * 1000 - 2 * 86_400_000,
                    now - 2 * 86_400_000,
                    now - 2 * 86_400_000,
                ],
            )
            .unwrap();
        let writer = Mutex::new(writer);
        let readers = Readers::open(path.to_str().unwrap(), 2).unwrap();
        // A reader waits for the writer's gate on the runtime, as a blocking thread would.
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let _runtime = runtime.enter();
        let gate = Gate::new(1, Duration::from_secs(1));
        let first = readers.acquire();
        let second = readers.acquire();
        assert!(first.execute("delete from session", []).is_err());
        let config = SessionConfig {
            secret: "test-secret".into(),
            secure: false,
        };
        let cookie = config.session_cookie("token");
        let session = find_session_with_writer(&first, &writer, &gate, &config, Some(&cookie), now)
            .unwrap()
            .unwrap();
        assert_eq!(session.user_id, "alice");
        let expiry: i64 = second
            .query_row("select expires_at from session", [], |r| r.get(0))
            .unwrap();
        assert_eq!(expiry, now + EXPIRES_IN_S * 1000);
        // Hold an old snapshot to simulate maintenance racing another reader's renewal.
        first.execute_batch("BEGIN").unwrap();
        let stale_expiry: i64 = first
            .query_row("select expires_at from session", [], |r| r.get(0))
            .unwrap();
        let refreshed_expiry = stale_expiry + 1 + EXPIRES_IN_S * 1000 + 60_000;
        writer
            .lock()
            .unwrap()
            .execute(
                "update session set expires_at = ?1, updated_at = ?2",
                [refreshed_expiry, stale_expiry + 1],
            )
            .unwrap();
        for request_now in [stale_expiry - 1, stale_expiry + 1] {
            assert!(
                find_session_with_writer(
                    &first,
                    &writer,
                    &gate,
                    &config,
                    Some(&cookie),
                    request_now
                )
                .unwrap()
                .is_some()
            );
            let actual: i64 = writer
                .lock()
                .unwrap()
                .query_row("select expires_at from session", [], |r| r.get(0))
                .unwrap();
            assert_eq!(actual, refreshed_expiry);
        }
        first.execute_batch("ROLLBACK").unwrap();
        assert!(
            find_session_with_writer(
                &second,
                &writer,
                &gate,
                &config,
                Some(&cookie),
                refreshed_expiry + 1
            )
            .unwrap()
            .is_none()
        );
        let count: i64 = first
            .query_row("select count(*) from session", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        drop(first);
        drop(second);
        // A returned lease can be acquired again without opening another connection.
        drop(readers.acquire());
        drop(readers);
        drop(writer);
        std::fs::remove_file(path).unwrap();
    }
}
