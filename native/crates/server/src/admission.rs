//! Admission happens asynchronously, before a call can occupy a blocking thread.
use crate::http::Response;
use crate::wire::failure;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// The database gates take their sizes from the connections: one slot per reader, and one
/// for the writer.
pub struct Limits {
    pub hashes: usize,
    pub queue_timeout: Duration,
    pub max_waiting: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            hashes: std::thread::available_parallelism().map_or(1, |n| n.get()),
            queue_timeout: Duration::from_secs(1),
            max_waiting: 4096,
        }
    }
}
pub(crate) struct Permit {
    _slot: OwnedSemaphorePermit,
}

pub(crate) struct Gate {
    slots: Arc<Semaphore>,
    #[cfg(feature = "bench")]
    capacity: usize,
    waiting: std::sync::atomic::AtomicUsize,
    timeout: Duration,
    max_waiting: usize,
}
impl Gate {
    #[cfg(test)]
    pub fn new(slots: usize, timeout: Duration) -> Self {
        Self::bounded(slots, 32, timeout)
    }
    pub fn bounded(slots: usize, max_waiting: usize, timeout: Duration) -> Self {
        assert!(slots > 0 && !timeout.is_zero());
        Self {
            slots: Arc::new(Semaphore::new(slots)),
            #[cfg(feature = "bench")]
            capacity: slots,
            waiting: std::sync::atomic::AtomicUsize::new(0),
            timeout,
            max_waiting,
        }
    }
    pub async fn acquire(&self) -> Result<Permit, Response> {
        self.acquire_by(self.deadline()).await
    }
    /// When a caller arriving now must be admitted by.
    pub fn deadline(&self) -> tokio::time::Instant {
        tokio::time::Instant::now() + self.timeout
    }
    /// A slot by `deadline`, so a call that passes several gates waits one deadline in all.
    pub async fn acquire_by(&self, deadline: tokio::time::Instant) -> Result<Permit, Response> {
        if let Some(permit) = self.try_acquire() {
            return Ok(permit);
        }
        let _waiting = Waiting::new(&self.waiting, self.max_waiting)
            .ok_or_else(|| Response::from(failure(503, "The server is busy. Try again.")))?;
        tokio::time::timeout_at(deadline, self.slots.clone().acquire_owned())
            .await
            .ok()
            .and_then(Result::ok)
            .map(|slot| Permit { _slot: slot })
            .ok_or_else(|| failure(503, "The server is busy. Try again.").into())
    }
    /// A slot if one is free now, without waiting.
    pub fn try_acquire(&self) -> Option<Permit> {
        self.slots
            .clone()
            .try_acquire_owned()
            .ok()
            .map(|slot| Permit { _slot: slot })
    }
    #[cfg(feature = "bench")]
    pub fn stats(&self) -> serde_json::Value {
        serde_json::json!({ "active": self.capacity-self.slots.available_permits(),
            "queued": self.waiting.load(std::sync::atomic::Ordering::Relaxed), "limit": self.capacity })
    }
    pub async fn run<T: Send + 'static>(
        &self,
        call: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, Response> {
        let permit = self.acquire().await?;
        Self::run_admitted(permit, call).await
    }
    pub(crate) async fn run_admitted<T: Send + 'static>(
        permit: Permit,
        call: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, Response> {
        #[cfg(feature = "bench")]
        let queued = crate::bench::Active::new(&crate::bench::QUEUED);
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            #[cfg(feature = "bench")]
            drop(queued);
            #[cfg(feature = "bench")]
            let _active = crate::bench::Active::new(&crate::bench::BLOCKING);
            #[cfg(feature = "bench")]
            crate::bench::mark_blocking_thread();
            call()
        })
        .await
        .map_err(|_| failure(500, "Internal error.").into())
    }
}

struct Waiting<'a>(&'a std::sync::atomic::AtomicUsize);
impl<'a> Waiting<'a> {
    fn new(counter: &'a std::sync::atomic::AtomicUsize, maximum: usize) -> Option<Self> {
        counter
            .try_update(
                std::sync::atomic::Ordering::Relaxed,
                std::sync::atomic::Ordering::Relaxed,
                |waiting| (waiting < maximum).then_some(waiting + 1),
            )
            .ok()?;
        Some(Self(counter))
    }
}
impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn count_bound_refuses_immediately_and_cancellation_frees_waiting() {
        use axum::response::IntoResponse;
        use std::sync::atomic::Ordering;
        let gate = Arc::new(Gate::bounded(1, 1, Duration::from_secs(60)));
        let running = gate.acquire().await.unwrap();
        let queued_gate = gate.clone();
        let queued = tokio::spawn(async move { queued_gate.acquire().await });
        while gate.waiting.load(Ordering::Relaxed) != 1 {
            tokio::task::yield_now().await;
        }
        let response = tokio::time::timeout(Duration::from_millis(50), gate.acquire())
            .await
            .expect("the count bound must not wait for the deadline")
            .err()
            .unwrap();
        assert_eq!(response.status, 503);
        assert_eq!(
            response.into_response().headers()[axum::http::header::RETRY_AFTER],
            "1"
        );
        queued.abort();
        let _ = queued.await;
        assert_eq!(gate.waiting.load(Ordering::Relaxed), 0);
        drop(running);
        assert!(gate.acquire().await.is_ok());
    }
    #[tokio::test]
    async fn gates_passed_in_turn_share_one_deadline() {
        let timeout = Duration::from_millis(200);
        let (first, second) = (Arc::new(Gate::new(1, timeout)), Gate::new(1, timeout));
        let held_first = first.acquire().await.unwrap();
        let _held_second = second.acquire().await.unwrap();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            drop(held_first);
        });
        let start = tokio::time::Instant::now();
        let deadline = first.deadline();
        let _admitted = first.acquire_by(deadline).await.unwrap();
        assert!(second.acquire_by(deadline).await.is_err());
        // Each gate's own deadline would have refused at 350 ms.
        assert!(start.elapsed() < Duration::from_millis(300));
    }
    #[test]
    fn blocking_work_is_only_spawned_by_admission() {
        fn check(path: &std::path::Path) {
            for entry in std::fs::read_dir(path).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    check(&path);
                } else if path.extension().is_some_and(|ext| ext == "rs")
                    && path.file_name().unwrap() != "admission.rs"
                {
                    let source = std::fs::read_to_string(&path).unwrap();
                    assert!(
                        !source.contains("spawn_blocking"),
                        "ungated blocking work: {}",
                        path.display()
                    );
                }
            }
        }
        check(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"));
    }
    #[tokio::test]
    async fn rejects_queue_timeout_and_releases_a_completed_slot() {
        let gate = Gate::new(1, Duration::from_millis(20));
        let permit = gate.acquire().await.unwrap();
        let refused = gate.acquire().await.err().unwrap();
        assert_eq!(refused.status, 503);
        use axum::response::IntoResponse;
        assert_eq!(
            refused.into_response().headers()[axum::http::header::RETRY_AFTER],
            "1"
        );
        drop(permit);
        assert_eq!(gate.run(|| 42).await.unwrap(), 42);
        assert!(gate.acquire().await.is_ok());
    }
    #[tokio::test]
    async fn cancelling_a_caller_does_not_release_running_work() {
        let gate = Arc::new(Gate::new(1, Duration::from_millis(20)));
        let (started, began) = tokio::sync::oneshot::channel();
        let (finish, wait) = std::sync::mpsc::channel();
        let worker_gate = gate.clone();
        let task = tokio::spawn(async move {
            worker_gate
                .run(move || {
                    started.send(()).unwrap();
                    wait.recv().unwrap();
                })
                .await
        });
        began.await.unwrap();
        task.abort();
        assert!(gate.acquire().await.is_err());
        finish.send(()).unwrap();
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(gate.acquire().await.is_ok());
    }
}
