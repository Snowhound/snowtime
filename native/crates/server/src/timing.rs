//! The Server-Timing header of API responses, with the names of task 088's
//! (src/server/timing.server.ts): `session` is the session check, and `db` is the time
//! SQLite spent running statements, the session's own reads included: from a statement's
//! start to its end, as SQLite's trace hook reports them. SQLite's own profile times count
//! whole milliseconds, too coarse here. Unlike the TypeScript `db`, which times the
//! client's calls, it leaves out waiting for the connection.
use std::cell::Cell;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use rusqlite::trace::{TraceEvent, TraceEventCodes};

// A request runs on one thread while it holds the connection, so its statements' times add
// up on that thread.
thread_local! {
    static DB: Cell<Duration> = const { Cell::new(Duration::ZERO) };
    // When the running statement started; a trigger's subprogram starts again inside it.
    static STARTED: Cell<Option<Instant>> = const { Cell::new(None) };
}

fn trace(event: TraceEvent<'_>) {
    match event {
        TraceEvent::Stmt(..) => STARTED.with(|s| {
            if s.get().is_none() {
                s.set(Some(Instant::now()));
            }
        }),
        TraceEvent::Profile(..) => {
            if let Some(started) = STARTED.with(Cell::take) {
                DB.with(|db| db.set(db.get() + started.elapsed()));
            }
        }
        _ => {}
    }
}

pub fn install(db: &Connection) {
    let events = TraceEventCodes::SQLITE_TRACE_STMT | TraceEventCodes::SQLITE_TRACE_PROFILE;
    db.trace_v2(events, Some(trace));
}

pub struct Timer {
    session: Duration,
}

impl Timer {
    pub fn start() -> Timer {
        DB.with(|db| db.set(Duration::ZERO));
        STARTED.with(|s| s.set(None));
        Timer {
            session: Duration::ZERO,
        }
    }

    pub fn session<T>(&mut self, check: impl FnOnce() -> T) -> T {
        let started = Instant::now();
        let result = check();
        self.session += started.elapsed();
        result
    }

    pub fn header(&self) -> String {
        let ms = |d: Duration| d.as_secs_f64() * 1000.0;
        format!(
            "session;dur={:.1}, db;dur={:.1}",
            ms(self.session),
            ms(DB.with(Cell::get))
        )
    }
}

#[cfg(feature = "bench")]
pub(crate) fn cpu_ms() -> f64 {
    #[cfg(target_os = "linux")]
    {
        let mut t = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // A thread-local CPU clock excludes time waiting for SQLite and the scheduler.
        unsafe {
            libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t);
        }
        t.tv_sec as f64 * 1000.0 + t.tv_nsec as f64 / 1e6
    }
    #[cfg(not(target_os = "linux"))]
    {
        0.0
    }
}
