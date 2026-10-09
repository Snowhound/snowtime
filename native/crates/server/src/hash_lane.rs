//! Dedicated password workers never lend their lower OS priority to database work.
use crate::lane::Lane;
use std::{io, time::Duration};

/// Hashes use at most one eighth of the host limit, within the render policy's headroom.
/// Each scrypt call holds 32 MiB; a configured concurrency can only reduce this cap.
pub fn hash_workers(bytes: u64, cpus: usize) -> usize {
    (bytes / 8 / (32 << 20)).max(1).min(cpus.max(1) as u64) as usize
}

pub(crate) type HashLane = Lane<()>;

/// Dedicated threads at lower priority; startup fails if one can't lower its own.
pub(crate) fn start(workers: usize, waiting: usize, timeout: Duration) -> io::Result<HashLane> {
    Lane::start(
        "password",
        vec![(); workers],
        waiting,
        timeout,
        lower_priority,
    )
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
    // A host already at the lowest priority has nothing below it to give hashes.
    if target == before {
        return Ok(());
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
    use std::sync::{Arc, mpsc};
    #[test]
    fn hashes_are_bounded_by_memory_and_cores() {
        assert_eq!(hash_workers(256 << 20, 8), 1);
        assert_eq!(hash_workers(512 << 20, 8), 2);
        assert_eq!(hash_workers(2048 << 20, 8), 8);
        assert_eq!(hash_workers(4096 << 20, 1), 1);
    }
    #[tokio::test]
    async fn dedicated_worker_survives_a_job_panic() {
        let lane = start(1, 1, Duration::from_millis(20)).unwrap();
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
        let lane = Arc::new(start(1, 0, Duration::from_secs(1)).unwrap());
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
        let db = Lane::start(
            "db",
            vec![()],
            1,
            Duration::from_secs(1),
            crate::lane::no_preparation,
        )
        .unwrap();
        let normal = db.run(|| priority().unwrap()).await.unwrap();
        let lane = start(2, 1, Duration::from_secs(1)).unwrap();
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
