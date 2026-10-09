//! A lane: admission through a gate, then a fixed set of dedicated threads fed by a bounded
//! channel ("Tokio at the edge, lanes behind it" in docs/architecture/native-host.md). Each
//! worker owns its state, such as a reader's connection, and no lane uses Tokio's blocking
//! pool, which serves only files and DNS.
use crate::admission::{Gate, Permit};
use crate::{http::Response, wire::failure};
use std::{
    io,
    ops::Deref,
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};

type Job<C> = Box<dyn FnOnce(&C) + Send>;

pub(crate) struct Lane<C> {
    gate: Gate,
    jobs: mpsc::SyncSender<Job<C>>,
}
impl<C: Send + 'static> Lane<C> {
    /// A worker per state, on threads named `{name}-{index}`. `prepare` runs first on each
    /// thread; an error there stops startup.
    pub fn start(
        name: &str,
        states: Vec<C>,
        waiting: usize,
        timeout: Duration,
        prepare: fn() -> io::Result<()>,
    ) -> io::Result<Self> {
        let workers = states.len();
        // The gate admits at most one job per worker, so the channel never fills.
        let (jobs, receive) = mpsc::sync_channel::<Job<C>>(workers);
        let receive = Arc::new(Mutex::new(receive));
        for (index, state) in states.into_iter().enumerate() {
            let receive = receive.clone();
            let (started, ready) = mpsc::sync_channel(1);
            std::thread::Builder::new()
                .name(format!("{name}-{index}"))
                .spawn(move || {
                    let prepared = prepare();
                    let failed = prepared.is_err();
                    if started.send(prepared).is_err() || failed {
                        return;
                    }
                    #[cfg(feature = "bench")]
                    crate::bench::mark_blocking_thread();
                    loop {
                        let job = receive.lock().unwrap_or_else(|e| e.into_inner()).recv();
                        let Ok(job) = job else { return };
                        // One bad job refuses its caller, without losing a lasting worker.
                        let _ =
                            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| job(&state)));
                    }
                })?;
            ready.recv().map_err(io::Error::other)??;
        }
        Ok(Self {
            gate: Gate::bounded(workers, waiting, timeout),
            jobs,
        })
    }
    pub async fn run_with<T: Send + 'static>(
        &self,
        call: impl FnOnce(&C) -> T + Send + 'static,
    ) -> Result<T, Response> {
        let permit = self.gate.acquire().await?;
        self.run_admitted(permit, call).await
    }
    /// Runs `call` with a permit of this lane's gate. A caller that leaves before a worker
    /// takes the job gets no answer, so the job doesn't run; one that leaves later doesn't
    /// stop it, and it keeps its permit until it ends.
    pub async fn run_admitted<T: Send + 'static>(
        &self,
        permit: Permit,
        call: impl FnOnce(&C) -> T + Send + 'static,
    ) -> Result<T, Response> {
        #[cfg(feature = "bench")]
        let queued = crate::bench::Active::new(&crate::bench::QUEUED);
        let (send, answer) = tokio::sync::oneshot::channel();
        self.jobs
            .try_send(Box::new(move |state| {
                let _permit = permit;
                #[cfg(feature = "bench")]
                drop(queued);
                if send.is_closed() {
                    return;
                }
                #[cfg(feature = "bench")]
                let _active = crate::bench::Active::new(&crate::bench::BLOCKING);
                let _ = send.send(call(state));
            }))
            .map_err(|_| Response::from(failure(503, "The server is busy. Try again.")))?;
        answer
            .await
            .map_err(|_| failure(500, "Internal error.").into())
    }
}
impl Lane<()> {
    pub async fn run<T: Send + 'static>(
        &self,
        call: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, Response> {
        self.run_with(move |()| call()).await
    }
}
// Admission without running anything: callers that pass several gates, and the session
// check that takes the writer only when its slot is free.
impl<C> Deref for Lane<C> {
    type Target = Gate;
    fn deref(&self) -> &Gate {
        &self.gate
    }
}

pub(crate) fn no_preparation() -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn lane(workers: usize) -> Lane<()> {
        Lane::start(
            "test",
            vec![(); workers],
            4,
            Duration::from_secs(1),
            no_preparation,
        )
        .unwrap()
    }

    #[tokio::test]
    async fn workers_are_dedicated_threads_that_survive_a_job_panic() {
        let lane = lane(1);
        assert_eq!(
            lane.run(|| panic!("bad job")).await.unwrap_err().status,
            500
        );
        assert_eq!(
            lane.run(|| std::thread::current().name().unwrap().to_owned())
                .await
                .unwrap(),
            "test-0"
        );
    }

    #[tokio::test]
    async fn each_worker_owns_its_state() {
        let lane = Lane::start(
            "owner",
            vec![7, 8],
            4,
            Duration::from_secs(1),
            no_preparation,
        )
        .unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let (a, b) = (barrier.clone(), barrier.clone());
        let (a, b) = tokio::join!(
            lane.run_with(move |n| {
                a.wait();
                (*n, std::thread::current().name().unwrap().to_owned())
            }),
            lane.run_with(move |n| {
                b.wait();
                (*n, std::thread::current().name().unwrap().to_owned())
            })
        );
        let mut seen = [a.unwrap(), b.unwrap()];
        seen.sort();
        assert_eq!(seen, [(7, "owner-0".to_owned()), (8, "owner-1".to_owned())]);
    }

    #[tokio::test]
    async fn a_job_whose_caller_left_before_it_started_does_not_run() {
        let mut lane = lane(1);
        // Two slots for one worker, so a second job can wait in the channel.
        lane.gate = Gate::new(2, Duration::from_secs(1));
        let lane = Arc::new(lane);
        let (finish, wait) = mpsc::channel::<()>();
        let (started, began) = tokio::sync::oneshot::channel();
        let blocker = tokio::spawn({
            let lane = lane.clone();
            async move {
                lane.run(move || {
                    started.send(()).unwrap();
                    wait.recv().unwrap();
                })
                .await
            }
        });
        began.await.unwrap();
        let ran = Arc::new(AtomicBool::new(false));
        let queued = tokio::spawn({
            let (lane, ran) = (lane.clone(), ran.clone());
            async move { lane.run(move || ran.store(true, Ordering::Relaxed)).await }
        });
        // Admitted to the second slot, the job waits in the channel behind the first.
        tokio::time::sleep(Duration::from_millis(20)).await;
        queued.abort();
        let _ = queued.await;
        finish.send(()).unwrap();
        blocker.await.unwrap().unwrap();
        // The one worker takes jobs in order, so this runs after the abandoned one.
        lane.run(|| ()).await.unwrap();
        assert!(!ran.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn a_running_job_keeps_its_permit_when_its_caller_leaves() {
        let lane = Arc::new(lane(1));
        let (started, began) = tokio::sync::oneshot::channel();
        let (finish, wait) = mpsc::channel::<()>();
        let task = tokio::spawn({
            let lane = lane.clone();
            async move {
                lane.run(move || {
                    started.send(()).unwrap();
                    wait.recv().unwrap();
                })
                .await
            }
        });
        began.await.unwrap();
        task.abort();
        let _ = task.await;
        assert!(lane.try_acquire().is_none());
        finish.send(()).unwrap();
        assert!(lane.acquire().await.is_ok());
    }
}
