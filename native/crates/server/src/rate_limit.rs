//! Request counts for the write rate limit, in this process's memory (memoryStore in
//! src/server/rate-limit.server.ts): fixed windows, each started by a key's first request.
use std::sync::Mutex;
pub mod layer;

/// Explicit overrides win over the development default.
pub fn enabled(node_env: Option<&str>, setting: Option<&str>) -> Result<bool, String> {
    match setting {
        None => Ok(node_env != Some("development")),
        Some("on") => Ok(true),
        Some("off") => Ok(false),
        _ => Err("RATE_LIMIT is on or off.".into()),
    }
}

use rustc_hash::FxHashMap;

/// A window in seconds and the requests it allows.
#[derive(Clone, Copy)]
pub struct RateLimitRule {
    pub window: i64,
    pub max: u32,
}

// rateLimits.writesPerUser in src/server/limits.server.ts.
pub const WRITES_PER_USER: RateLimitRule = RateLimitRule {
    window: 60,
    max: 120,
};

struct Window {
    count: u32,
    ends_at: i64,
}

// Keys are user IDs from the session row, which the server made, so FxHash serves.
pub struct MemoryStore {
    enabled: bool,
    windows: Mutex<FxHashMap<String, Window>>,
}

impl Default for MemoryStore {
    fn default() -> Self {
        Self::new(true)
    }
}

impl MemoryStore {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            windows: Mutex::new(FxHashMap::default()),
        }
    }
    /// Counts one request and says whether it fits.
    pub fn consume(&self, key: &str, rule: RateLimitRule, now: i64) -> bool {
        if !self.enabled {
            return true;
        }
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        // Drops ended windows now and then, so keys of past users don't pile up.
        if windows.len() > 10_000 {
            windows.retain(|_, w| w.ends_at > now);
        }
        let window = match windows.get_mut(key) {
            Some(w) if w.ends_at > now => w,
            _ => {
                let fresh = Window {
                    count: 0,
                    ends_at: now + rule.window * 1000,
                };
                windows.entry(key.to_owned()).insert_entry(fresh).into_mut()
            }
        };
        window.count = window.count.saturating_add(1);
        window.count <= rule.max
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_switch_defaults_on_except_in_development_and_accepts_overrides() {
        for env in [None, Some("production"), Some("test"), Some("development")] {
            assert_eq!(enabled(env, None).unwrap(), env != Some("development"));
            assert!(enabled(env, Some("on")).unwrap());
            assert!(!enabled(env, Some("off")).unwrap());
            assert!(enabled(env, Some("false")).is_err());
        }
    }
    #[test]
    fn write_windows_reset_at_the_boundary_and_off_does_not_count() {
        let store = MemoryStore::default();
        let rule = RateLimitRule { window: 10, max: 2 };
        assert!(store.consume("alice", rule, 0));
        assert!(store.consume("alice", rule, 9999));
        assert!(!store.consume("alice", rule, 9999));
        assert!(store.consume("bob", rule, 9999));
        assert!(store.consume("alice", rule, 10000));
        let off = MemoryStore::new(false);
        for _ in 0..200 {
            assert!(off.consume("alice", rule, 0));
        }
        assert!(off.windows.lock().unwrap().is_empty());
    }
}
