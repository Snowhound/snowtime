//! Admission happens asynchronously, before a call can occupy a blocking thread.
use crate::http::Response;
use crate::wire::failure;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub struct Limits {
    pub db_calls: usize,
    pub hashes: usize,
    pub queue_timeout: Duration,
}
impl Limits {
    pub fn for_readers(readers: usize) -> Self {
        Self {
            db_calls: readers + 2,
            hashes: std::thread::available_parallelism().map_or(1, |n| n.get()),
            queue_timeout: Duration::from_secs(1),
        }
    }
}
pub(crate) struct Gate {
    slots: Arc<Semaphore>,
    #[cfg(feature = "bench")]
    capacity: usize,
    #[cfg(feature = "bench")]
    waiting: std::sync::atomic::AtomicUsize,
    timeout: Duration,
}
impl Gate {
    pub fn new(slots: usize, timeout: Duration) -> Self {
        assert!(slots > 0 && !timeout.is_zero());
        Self {
            slots: Arc::new(Semaphore::new(slots)),
            #[cfg(feature = "bench")]
            capacity: slots,
            #[cfg(feature = "bench")]
            waiting: std::sync::atomic::AtomicUsize::new(0),
            timeout,
        }
    }
    pub async fn acquire(&self) -> Result<OwnedSemaphorePermit, Response> {
        #[cfg(feature = "bench")]
        let _waiting = Waiting::new(&self.waiting);
        tokio::time::timeout(self.timeout, self.slots.clone().acquire_owned())
            .await
            .ok()
            .and_then(Result::ok)
            .ok_or_else(|| failure(503, "The server is busy. Try again.").into())
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

#[cfg(feature = "bench")]
struct Waiting<'a>(&'a std::sync::atomic::AtomicUsize);
#[cfg(feature = "bench")]
impl<'a> Waiting<'a> {
    fn new(counter: &'a std::sync::atomic::AtomicUsize) -> Self {
        counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Self(counter)
    }
}
#[cfg(feature = "bench")]
impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
