//! Dedicated password workers never lend their lower OS priority to database work.
use crate::{admission::Gate, http::Response, wire::failure};
use std::{
    io,
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};

/// Hashes use at most one eighth of the host limit, within the render policy's headroom.
/// Each scrypt call holds 32 MiB; a configured concurrency can only reduce this cap.
pub fn hash_workers(bytes: u64, cpus: usize) -> usize {
    (bytes / 8 / (32 << 20)).max(1).min(cpus.max(1) as u64) as usize
}

type Job = Box<dyn FnOnce() + Send>;
pub(crate) struct HashLane {
    gate: Gate,
    jobs: mpsc::SyncSender<Job>,
}
impl HashLane {
    pub fn new(workers: usize, waiting: usize, timeout: Duration) -> io::Result<Self> {
        let (jobs, receive) = mpsc::sync_channel::<Job>(workers);
        let receive = Arc::new(Mutex::new(receive));
        for index in 0..workers {
            let receive = receive.clone();
            let (started, ready) = mpsc::sync_channel(1);
            std::thread::Builder::new()
                .name(format!("password-{index}"))
                .spawn(move || {
                    let priority = lower_priority();
                    let failed = priority.is_err();
                    if started.send(priority).is_err() || failed {
                        return;
                    }
                    loop {
                        let job = receive.lock().unwrap().recv();
                        let Ok(job) = job else { return };
                        // One bad job refuses its caller, without losing a lasting worker.
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
                    }
                })?;
            ready.recv().map_err(io::Error::other)??;
        }
        Ok(Self {
            gate: Gate::bounded(workers, waiting, timeout),
            jobs,
        })
    }
    pub async fn run<T: Send + 'static>(
        &self,
        call: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, Response> {
        let permit = self.gate.acquire().await?;
        let (send, result) = tokio::sync::oneshot::channel();
        self.jobs
            .try_send(Box::new(move || {
                let _permit = permit;
                if !send.is_closed() {
                    let _ = send.send(call());
                }
            }))
            .map_err(|_| Response::from(failure(503, "The server is busy. Try again.")))?;
        result
            .await
            .map_err(|_| failure(500, "Internal error.").into())
    }
    #[cfg(feature = "bench")]
    pub fn stats(&self) -> serde_json::Value {
        self.gate.stats()
    }
}

#[cfg(target_os = "linux")]
fn priority() -> io::Result<i32> {
    // Linux niceness is per thread. errno disambiguates a successful value of -1.
    unsafe {
        *libc::__errno_location() = 0;
        let nice = libc::getpriority(libc::PRIO_PROCESS, 0);
        if *libc::__errno_location() != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(nice)
    }
}
#[cfg(target_os = "linux")]
fn lower_priority() -> io::Result<()> {
    let before = priority()?;
    let target = (before + 5).min(19);
    if target <= before {
        return Err(io::Error::other("password priority cannot be lowered"));
    }
    if unsafe { libc::setpriority(libc::PRIO_PROCESS, 0, target) } != 0 {
        return Err(io::Error::last_os_error());
    }
    if priority()? != target {
        return Err(io::Error::other("password priority was not applied"));
    }
    Ok(())
}
#[cfg(not(target_os = "linux"))]
fn lower_priority() -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hashes_are_bounded_by_memory_and_cores() {
        assert_eq!(hash_workers(256 << 20, 8), 1);
        assert_eq!(hash_workers(512 << 20, 8), 2);
        assert_eq!(hash_workers(2048 << 20, 8), 8);
        assert_eq!(hash_workers(4096 << 20, 1), 1);
    }
    #[tokio::test]
    async fn dedicated_worker_survives_a_job_panic() {
        let lane = HashLane::new(1, 1, Duration::from_millis(20)).unwrap();
        assert_eq!(
            lane.run(|| panic!("bad job")).await.unwrap_err().status,
            500
        );
        assert_eq!(
            lane.run(|| std::thread::current().name().unwrap().to_owned())
                .await
                .unwrap(),
            "password-0"
        );
    }
    #[tokio::test]
    async fn cancellation_keeps_the_running_hash_permit() {
        let lane = Arc::new(HashLane::new(1, 0, Duration::from_secs(1)).unwrap());
        let (send, started) = tokio::sync::oneshot::channel();
        let (finish, wait) = mpsc::channel();
        let worker = lane.clone();
        let task = tokio::spawn(async move {
            worker
                .run(move || {
                    send.send(()).unwrap();
                    wait.recv().unwrap();
                })
                .await
        });
        started.await.unwrap();
        task.abort();
        let _ = task.await;
        assert_eq!(lane.run(|| ()).await.unwrap_err().status, 503);
        finish.send(()).unwrap();
    }
    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn linux_priority_is_applied_only_to_password_threads() {
        let edge = priority().unwrap();
        let db = Gate::new(1, Duration::from_secs(1));
        let normal = db.run(|| priority().unwrap()).await.unwrap();
        let lane = HashLane::new(2, 1, Duration::from_secs(1)).unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let a = barrier.clone();
        let b = barrier.clone();
        let (a, b) = tokio::join!(
            lane.run(move || {
                a.wait();
                priority().unwrap()
            }),
            lane.run(move || {
                b.wait();
                priority().unwrap()
            })
        );
        assert_eq!(a.unwrap(), (edge + 5).min(19));
        assert_eq!(b.unwrap(), (edge + 5).min(19));
        assert!(normal < (edge + 5).min(19));
        assert_eq!(db.run(|| priority().unwrap()).await.unwrap(), normal);
        assert_eq!(priority().unwrap(), edge);
    }
}
