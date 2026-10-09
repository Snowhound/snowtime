//! The server's clock. In `bench` and debug builds, PERF_NOW, in milliseconds, moves it to
//! that moment at startup and lets it run on from there, as perf/lib/clock.ts does for the
//! TypeScript server, so the conformance tests' "today" lands on the seeded data. Other
//! builds refuse to start with it set.
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static OFFSET: OnceLock<i64> = OnceLock::new();

fn real_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// Reads PERF_NOW and returns the moment it set, for the host to log.
pub fn init_from_env() -> Result<Option<i64>, String> {
    init(std::env::var("PERF_NOW").ok().as_deref())
}

#[cfg(any(feature = "bench", debug_assertions))]
fn init(value: Option<&str>) -> Result<Option<i64>, String> {
    // JavaScript's Date range, which keeps the offset and the shifted clock in range.
    const MAX_MS: i64 = 8_640_000_000_000_000;
    let Some(value) = value else {
        return Ok(None);
    };
    let target = value
        .parse::<i64>()
        .ok()
        .filter(|t| (0..=MAX_MS).contains(t))
        .ok_or("PERF_NOW is milliseconds since the epoch.")?;
    let _ = OFFSET.set(target - real_now());
    Ok(Some(target))
}
#[cfg(not(any(feature = "bench", debug_assertions)))]
fn init(value: Option<&str>) -> Result<Option<i64>, String> {
    match value {
        Some(_) => Err("PERF_NOW works only in bench and debug builds; unset it.".into()),
        None => Ok(None),
    }
}

/// Milliseconds since the epoch, as `Date.now()`.
pub fn now() -> i64 {
    real_now().saturating_add(OFFSET.get().copied().unwrap_or(0))
}

/// Whether PERF_NOW moved the clock, so pages render at the same moment as the API.
pub fn is_shifted() -> bool {
    OFFSET.get().is_some_and(|&offset| offset != 0)
}

#[cfg(test)]
mod tests {
    // Only refusals: a valid value would move the clock for every test in this process.
    #[test]
    fn perf_now_refuses_values_outside_dates() {
        for value in ["soon", "-1", "8640000000000001", "9223372036854775807"] {
            assert!(super::init(Some(value)).is_err(), "{value}");
        }
        assert_eq!(super::init(None), Ok(None));
    }
}
