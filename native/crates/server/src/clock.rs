//! The server's clock. PERF_NOW, in milliseconds, moves it to that moment at startup and
//! lets it run on from there, as perf/lib/clock.ts does for the TypeScript server, so the
//! conformance tests' "today" lands on the seeded data.
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static OFFSET: OnceLock<i64> = OnceLock::new();

fn real_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

pub fn init_from_env() {
    let target = std::env::var("PERF_NOW")
        .ok()
        .and_then(|v| v.parse::<i64>().ok());
    let _ = OFFSET.set(target.map_or(0, |t| t - real_now()));
}

/// Milliseconds since the epoch, as `Date.now()`.
pub fn now() -> i64 {
    real_now() + OFFSET.get().copied().unwrap_or(0)
}

/// Whether PERF_NOW moved the clock, so pages render at the same moment as the API.
pub fn is_shifted() -> bool {
    OFFSET.get().is_some_and(|&offset| offset != 0)
}
