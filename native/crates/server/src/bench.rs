//! Diagnostics compiled only into the benchmark image.
use std::sync::atomic::{AtomicUsize, Ordering};
pub(crate) static SQLITE_BUSY_ERRORS: AtomicUsize = AtomicUsize::new(0);
pub(crate) static QUEUED: AtomicUsize = AtomicUsize::new(0);
pub(crate) static BLOCKING: AtomicUsize = AtomicUsize::new(0);
pub(crate) static BLOCKING_THREADS: AtomicUsize = AtomicUsize::new(0);
pub(crate) static BLOCKING_THREADS_PEAK: AtomicUsize = AtomicUsize::new(0);
struct BlockingThread;
impl BlockingThread {
    fn new() -> Self {
        let count = BLOCKING_THREADS.fetch_add(1, Ordering::Relaxed) + 1;
        BLOCKING_THREADS_PEAK.fetch_max(count, Ordering::Relaxed);
        Self
    }
}
impl Drop for BlockingThread {
    fn drop(&mut self) {
        BLOCKING_THREADS.fetch_sub(1, Ordering::Relaxed);
    }
}
std::thread_local! {
    static BLOCKING_THREAD: BlockingThread = BlockingThread::new();
}
// Counts live workers that execute DB/hash jobs; retirement drops their thread-local guard.
pub(crate) fn mark_blocking_thread() {
    BLOCKING_THREAD.with(|_| {});
}
pub(crate) static SCRYPT: AtomicUsize = AtomicUsize::new(0);
pub(crate) static SCRYPT_PEAK: AtomicUsize = AtomicUsize::new(0);
pub(crate) struct Active(&'static AtomicUsize);
impl Active {
    pub fn new(counter: &'static AtomicUsize) -> Self {
        counter.fetch_add(1, Ordering::Relaxed);
        Self(counter)
    }
}
impl Drop for Active {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}
pub(crate) fn sqlite(db: &rusqlite::Connection) -> serde_json::Value {
    fn status(db: &rusqlite::Connection, code: i32) -> i32 {
        let (mut current, mut peak) = (0, 0);
        // SAFETY: the caller owns the connection; SQLite writes only these two outputs.
        unsafe {
            rusqlite::ffi::sqlite3_db_status(db.handle(), code, &mut current, &mut peak, 0);
        }
        current
    }
    serde_json::json!({
        "cache_bytes": status(db, rusqlite::ffi::SQLITE_DBSTATUS_CACHE_USED),
        "statement_bytes": status(db, rusqlite::ffi::SQLITE_DBSTATUS_STMT_USED),
        "cache_hits": status(db, rusqlite::ffi::SQLITE_DBSTATUS_CACHE_HIT),
        "cache_misses": status(db, rusqlite::ffi::SQLITE_DBSTATUS_CACHE_MISS),
        "cache_writes": status(db, rusqlite::ffi::SQLITE_DBSTATUS_CACHE_WRITE) })
}

#[derive(Default)]
pub(crate) struct SignInTrace(std::sync::Mutex<SignInTimes>);
#[derive(Default)]
struct SignInTimes {
    connection_wait: f64,
    connection_hold: f64,
    cpu: f64,
    scrypt_cpu: f64,
}
pub(crate) struct SignInWork {
    trace: std::sync::Arc<SignInTrace>,
    began: std::time::Instant,
    cpu: f64,
    hash: bool,
}
impl SignInTrace {
    pub fn locked(self: &std::sync::Arc<Self>, waiting: std::time::Instant) -> SignInWork {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .connection_wait += waiting.elapsed().as_secs_f64() * 1000.0;
        self.work(false)
    }
    pub fn hashing(self: &std::sync::Arc<Self>) -> SignInWork {
        self.work(true)
    }
    fn work(self: &std::sync::Arc<Self>, hash: bool) -> SignInWork {
        SignInWork {
            trace: self.clone(),
            began: std::time::Instant::now(),
            cpu: crate::timing::cpu_ms(),
            hash,
        }
    }
    pub fn header(&self) -> String {
        let times = self.0.lock().unwrap_or_else(|e| e.into_inner());
        format!(
            "connection_wait;dur={:.3}, connection_hold;dur={:.3}, cpu;dur={:.3}, scrypt_cpu;dur={:.3}",
            times.connection_wait, times.connection_hold, times.cpu, times.scrypt_cpu
        )
    }
}
impl Drop for SignInWork {
    fn drop(&mut self) {
        let cpu = crate::timing::cpu_ms() - self.cpu;
        let mut times = self.trace.0.lock().unwrap_or_else(|e| e.into_inner());
        times.cpu += cpu;
        if self.hash {
            times.scrypt_cpu += cpu;
        } else {
            times.connection_hold += self.began.elapsed().as_secs_f64() * 1000.0;
        }
    }
}
