//! Request counts for the write rate limit, in this process's memory (memoryStore in
//! src/server/rate-limit.server.ts): fixed windows, each started by a key's first request.
use std::sync::Mutex;

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
#[derive(Default)]
pub struct MemoryStore {
    windows: Mutex<FxHashMap<String, Window>>,
}

impl MemoryStore {
    /// Counts one request and says whether it fits.
    pub fn consume(&self, key: &str, rule: RateLimitRule, now: i64) -> bool {
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
        window.count += 1;
        window.count <= rule.max
    }
}
