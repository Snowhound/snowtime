use deno_core::v8::IsolateHandle;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

struct State {
    armed: Option<(Instant, IsolateHandle)>,
    stopped: bool,
}
pub struct Deadline {
    state: Arc<(Mutex<State>, Condvar)>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Deadline {
    pub fn new() -> Self {
        let state = Arc::new((
            Mutex::new(State {
                armed: None,
                stopped: false,
            }),
            Condvar::new(),
        ));
        let worker = state.clone();
        let thread = std::thread::Builder::new()
            .name("render-deadline".into())
            .spawn(move || {
                let (lock, wake) = &*worker;
                let mut state = lock.lock().unwrap();
                while !state.stopped {
                    if let Some((end, handle)) = &state.armed {
                        let remaining = end.saturating_duration_since(Instant::now());
                        if remaining.is_zero() {
                            handle.terminate_execution();
                            state.armed = None;
                        } else {
                            state = wake.wait_timeout(state, remaining).unwrap().0;
                        }
                    } else {
                        state = wake.wait(state).unwrap();
                    }
                }
            })
            .unwrap();
        Self {
            state,
            thread: Some(thread),
        }
    }
    pub fn arm(&self, duration: Duration, handle: IsolateHandle) {
        self.state.0.lock().unwrap().armed = Some((Instant::now() + duration, handle));
        self.state.1.notify_one();
    }
    pub fn disarm(&self) {
        self.state.0.lock().unwrap().armed = None;
        self.state.1.notify_one();
    }
}
impl Drop for Deadline {
    fn drop(&mut self) {
        self.state.0.lock().unwrap().stopped = true;
        self.state.1.notify_one();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
