//! A pool of V8 renderers, each on a thread of its own. The host supplies the app's JSON API
//! by path; a page comes back whole, so a slow client never holds a renderer.
mod deadline;
mod extensions;
mod profile;
#[cfg(test)]
mod web_api_tests;

use deno_core::{JsRuntime, OpState, RuntimeOptions, op2};
use deno_error::JsErrorBox;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;
use std::{cell::RefCell, future::Future, pin::Pin, rc::Rc, sync::Arc, time::Duration};
use tokio::sync::{Notify, oneshot};

/// The client manifest of the app build the bundle was built beside (bundle/build.ts).
pub const MANIFEST: &str = include_str!(concat!(env!("OUT_DIR"), "/manifest.json"));

pub type Headers = Vec<(String, String)>;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ApiRequest {
    pub method: String,
    pub path: String,
    pub headers: Headers,
    pub body: Vec<u8>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ApiResponse {
    pub status: u16,
    pub headers: Headers,
    pub body: Vec<u8>,
}
pub type HostFuture = Pin<Box<dyn Future<Output = Result<ApiResponse, String>> + Send>>;
pub type SendApi = Arc<dyn Fn(ApiRequest) -> HostFuture + Send + Sync>;

/// A page to render. The bundle reads the locale from the request when it is absent; `now`
/// is only for reproducible measurements.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PageRequest {
    pub url: String,
    pub method: String,
    pub headers: Headers,
    pub cookie: String,
    pub nonce: String,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub now: Option<i64>,
}

#[derive(Debug)]
pub struct Page {
    pub status: u16,
    pub headers: Headers,
    pub body: Vec<u8>,
}

#[derive(Debug)]
pub enum RenderError {
    /// The queue was full, or the page waited in it longer than the policy allows.
    Busy,
    /// An API dependency refused this page; preserve its retry interval.
    ApiRefused { retry_after: String },
    /// The render threw, ran past its deadline, or outgrew the page limit.
    Failed(String),
    /// Renderers crashed past the restart budget; the pool takes no more pages.
    Down,
}

#[derive(Clone, Debug)]
pub struct Policy {
    /// Collect after this long without a page.
    pub idle: Duration,
    /// V8's heap limit; past it, the page fails and the isolate is replaced.
    pub heap_limit_bytes: usize,
    /// Collect after a page that leaves more than this in V8's old generation.
    pub collect_heap_bytes: usize,
    /// Replace the isolate when a collection leaves more than this live in the old
    /// generation.
    pub replace_heap_bytes: usize,
    /// The size of each of the young generation's two semi-spaces; `None` keeps V8's
    /// default, which grows with the heap limit. A set size replaces V8's young
    /// generation, a small part of `heap_limit_bytes`, with three times this size, and
    /// leaves the old generation's limit as it was: at 128 MiB and 32 MiB the whole heap
    /// may reach about 212 MiB.
    pub semi_space_bytes: Option<usize>,
    pub deadline: Duration,
    pub queue_capacity: usize,
    /// A page that waited longer than this is refused as Busy instead of rendered.
    pub max_queue_wait: Duration,
    pub max_page_bytes: usize,
    pub min_renderers: usize,
    pub max_renderers: usize,
    /// An extra renderer idle this long stops.
    pub retire_after: Duration,
    /// Renderer threads that panic are restarted at most this many times in
    /// `restart_window`; past that the pool is down. Isolate replacements don't count.
    pub restart_budget: usize,
    pub restart_window: Duration,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            idle: Duration::from_secs(1),
            heap_limit_bytes: 128 << 20,
            collect_heap_bytes: 48 << 20,
            replace_heap_bytes: 80 << 20,
            semi_space_bytes: None,
            deadline: Duration::from_secs(5),
            queue_capacity: 64,
            max_queue_wait: Duration::from_secs(1),
            max_page_bytes: 8 << 20,
            min_renderers: 1,
            max_renderers: 1,
            retire_after: Duration::from_secs(30),
            restart_budget: 5,
            restart_window: Duration::from_secs(60),
        }
    }
}

#[derive(Default)]
struct Output {
    head: Option<(u16, Headers)>,
    body: Vec<u8>,
    limit: usize,
    retry_after: Option<String>,
}
#[derive(Serialize)]
struct JsApiResponse {
    status: u16,
    headers: Headers,
    body: deno_core::ToJsBuffer,
}
#[op2]
#[serde]
async fn op_send(
    state: Rc<RefCell<OpState>>,
    #[serde] request: ApiRequest,
) -> Result<JsApiResponse, JsErrorBox> {
    let send = state.borrow().borrow::<SendApi>().clone();
    let answer = send(request).await.map_err(JsErrorBox::generic)?;
    if answer.status == 503 {
        let retry_after = answer
            .headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("retry-after"))
            .map_or_else(|| "1".into(), |(_, value)| value.clone());
        state.borrow_mut().borrow_mut::<Output>().retry_after = Some(retry_after);
    }
    Ok(JsApiResponse {
        status: answer.status,
        headers: answer.headers,
        body: answer.body.into(),
    })
}
#[op2]
fn op_head(state: &mut OpState, #[smi] status: u16, #[serde] headers: Headers) {
    state.borrow_mut::<Output>().head = Some((status, headers));
}
#[op2(fast)]
fn op_chunk(state: &mut OpState, #[buffer] bytes: &[u8]) -> Result<(), JsErrorBox> {
    let output = state.borrow_mut::<Output>();
    if output.body.len() + bytes.len() > output.limit {
        return Err(JsErrorBox::generic("The page is larger than the limit"));
    }
    output.body.extend_from_slice(bytes);
    Ok(())
}
deno_core::extension!(host, ops = [op_send, op_head, op_chunk]);

/// One isolate. Only one page renders at a time, so cookies, locale, and query caches
/// cannot overlap.
struct Renderer {
    profile: Option<profile::Profile>,
    runtime: Option<JsRuntime>,
    deadline: deadline::Deadline,
    send: SendApi,
    manifest: Arc<str>,
    policy: Policy,
}
impl Renderer {
    fn new(send: SendApi, manifest: Arc<str>, policy: Policy) -> Self {
        let mut exts = extensions::extensions();
        exts.push(host::init());
        let mut runtime = JsRuntime::new(RuntimeOptions {
            inspector: profile::Profile::enabled(),
            startup_snapshot: Some(include_bytes!(concat!(env!("OUT_DIR"), "/render.bin"))),
            extensions: exts,
            create_params: Some(create_params(&policy)),
            ..Default::default()
        });
        let handle = runtime.v8_isolate().thread_safe_handle();
        runtime.add_near_heap_limit_callback(move |limit, _| {
            handle.terminate_execution();
            limit + 16 * 1024 * 1024
        });
        runtime.op_state().borrow_mut().put(send.clone());
        runtime
            .execute_script(
                "manifest.js",
                format!("globalThis.renderManifest = {manifest}"),
            )
            .expect("the manifest is JSON");
        let profile = profile::Profile::new(&mut runtime);
        Self {
            profile,
            runtime: Some(runtime),
            deadline: deadline::Deadline::new(),
            send,
            manifest,
            policy,
        }
    }
    // Taken only in reset(), which puts a fresh runtime back before returning.
    fn js(&mut self) -> &mut JsRuntime {
        self.runtime.as_mut().expect("the renderer has a runtime")
    }
    fn reset(&mut self) {
        self.js().v8_isolate().cancel_terminate_execution();
        // Dispose this isolate before entering its replacement on the same thread.
        drop(self.profile.take());
        drop(self.runtime.take());
        *self = Self::new(
            self.send.clone(),
            self.manifest.clone(),
            self.policy.clone(),
        );
    }
    // The young generation is left out: a scavenge empties it, and counting it would make
    // a larger nursery trigger a full collection after every page.
    fn old_generation_bytes(&mut self) -> usize {
        let isolate = self.js().v8_isolate();
        (0..isolate.number_of_heap_spaces())
            .filter_map(|space| isolate.get_heap_space_statistics(space))
            .filter(|space| !space.space_name().to_bytes().starts_with(b"new_"))
            .map(|space| space.space_used_size())
            .sum()
    }
    fn collect(&mut self) {
        self.js().v8_isolate().low_memory_notification();
        trim();
        if self.old_generation_bytes() > self.policy.replace_heap_bytes {
            self.reset();
        }
    }
    /// Renders a page, or stops when `cancelled` completes; stopping replaces the isolate,
    /// which drops the API calls the page has in flight.
    async fn render(
        &mut self,
        request: &PageRequest,
        cancelled: impl Future<Output = ()>,
    ) -> Result<Page, RenderError> {
        if let Some(profile) = &mut self.profile {
            profile.before();
        }
        let limit = self.policy.max_page_bytes;
        self.js().op_state().borrow_mut().put(Output {
            limit,
            ..Default::default()
        });
        let isolate = self.js().v8_isolate().thread_safe_handle();
        self.deadline.arm(self.policy.deadline, isolate);
        let deadline = self.policy.deadline;
        let work = tokio::time::timeout(deadline, async {
            let value = self.js().execute_script(
                "page.js",
                format!("renderPage({})", serde_json::to_string(request)?),
            )?;
            let promise = self.js().resolve(value);
            self.js()
                .with_event_loop_promise(promise, Default::default())
                .await?;
            Ok::<(), anyhow::Error>(())
        });
        let result = tokio::select! {
            result = work => result
                .unwrap_or_else(|_| Err(anyhow::anyhow!("Render deadline exceeded"))),
            () = cancelled => Err(anyhow::anyhow!("The page was cancelled")),
        };
        self.deadline.disarm();
        if let Some(profile) = &mut self.profile {
            profile.after();
        }
        let output = self.js().op_state().borrow_mut().take::<Output>();
        if let Some(retry_after) = output.retry_after {
            // A framework may catch the dependency error and emit a 500 or partial page.
            // The host still owes the caller the dependency's admission refusal.
            self.reset();
            return Err(RenderError::ApiRefused { retry_after });
        }
        match (result, output.head) {
            (Ok(()), Some((status, headers))) => Ok(Page {
                status,
                headers,
                body: output.body,
            }),
            (result, _) => {
                // A failed render may leave locale, timers, or query work behind.
                self.reset();
                Err(RenderError::Failed(
                    result
                        .err()
                        .map_or("The page sent no head".into(), |e| e.to_string()),
                ))
            }
        }
    }
}

fn create_params(policy: &Policy) -> deno_core::v8::CreateParams {
    let params = deno_core::v8::CreateParams::default().heap_limits(0, policy.heap_limit_bytes);
    let Some(semi_space) = policy.semi_space_bytes else {
        return params;
    };
    // V8 sizes the young generation as two semi-spaces plus a large-object space of the
    // same size. Starting it at its maximum keeps it from growing through extra scavenges.
    params
        .set_initial_young_generation_size_in_bytes(semi_space * 3)
        .set_max_young_generation_size_in_bytes(semi_space * 3)
}

// glibc keeps what V8's compiler and the page buffers freed, 55-60 MiB; return it to the
// system. A no-op elsewhere.
fn trim() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    // malloc_trim only releases free memory.
    unsafe {
        libc::malloc_trim(0);
    }
}

// Under steady load a renderer may not collect for a long time; it trims this often anyway.
const TRIM_EVERY_PAGES: u32 = 64;

struct Job {
    id: u64,
    request: PageRequest,
    queued: Instant,
    reply: oneshot::Sender<Result<Page, RenderError>>,
}

// A renderer thread's exit, or the last Pool clone's drop, for the supervisor.
enum Exit {
    Thread(u64),
    Closed,
}

struct Shared {
    // Pages waiting for a renderer. A caller withdraws its page when it stops waiting.
    queue: Mutex<VecDeque<Job>>,
    ready: Notify,
    next_job: AtomicU64,
    send: SendApi,
    manifest: Arc<str>,
    policy: Policy,
    renderers: AtomicUsize,
    // Renderers in the middle of a page.
    busy: AtomicUsize,
    #[cfg(feature = "bench")]
    refused: AtomicUsize,
    spawning: AtomicBool,
    pressure: AtomicBool,
    closed: AtomicBool,
    // Set under the queue's lock, so no page is queued after the queue is drained.
    down: AtomicBool,
    // When renderer threads panicked, within the restart window.
    crashes: Mutex<VecDeque<Instant>>,
    threads: Mutex<HashMap<u64, std::thread::JoinHandle<()>>>,
    next_thread: AtomicU64,
    exits: std::sync::mpsc::Sender<Exit>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// The renderers and their shared queue. Clones share them; dropping the last stops them.
#[derive(Clone)]
pub struct Pool {
    shared: Arc<Shared>,
    _owner: Arc<Owner>,
}

struct Owner(Arc<Shared>);
impl Drop for Owner {
    fn drop(&mut self) {
        self.0.closed.store(true, Ordering::SeqCst);
        self.0.ready.notify_waiters();
        let _ = self.0.exits.send(Exit::Closed);
    }
}

pub struct Stats {
    pub renderers: usize,
    pub queued: usize,
    #[cfg(feature = "bench")]
    pub refused: usize,
}

/// The render lane's state for the host's readiness check.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Health {
    Ready,
    /// A renderer crashed and was restarted within the restart window.
    Degraded,
    /// Past the restart budget: pages answer `RenderError::Down`.
    Down,
}

impl Pool {
    /// Starts `min_renderers` renderers. `manifest` is the client manifest of the build whose
    /// assets the host serves.
    pub fn start(send: SendApi, manifest: &str, policy: Policy) -> Result<Self, String> {
        let (exits, exited) = std::sync::mpsc::channel();
        let shared = Arc::new(Shared {
            queue: Mutex::new(VecDeque::with_capacity(policy.queue_capacity)),
            ready: Notify::new(),
            next_job: AtomicU64::new(0),
            send,
            manifest: manifest.into(),
            renderers: AtomicUsize::new(0),
            busy: AtomicUsize::new(0),
            #[cfg(feature = "bench")]
            refused: AtomicUsize::new(0),
            spawning: AtomicBool::new(false),
            pressure: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            down: AtomicBool::new(false),
            crashes: Mutex::new(VecDeque::new()),
            threads: Mutex::new(HashMap::new()),
            next_thread: AtomicU64::new(0),
            exits,
            policy,
        });
        let pool = Pool {
            shared: shared.clone(),
            _owner: Arc::new(Owner(shared.clone())),
        };
        std::thread::Builder::new()
            .name("render-supervisor".into())
            .spawn(move || supervise(shared, exited))
            .map_err(|e| e.to_string())?;
        for _ in 0..pool.shared.policy.min_renderers.max(1) {
            pool.shared.renderers.fetch_add(1, Ordering::SeqCst);
            spawn_renderer(&pool.shared)?;
        }
        Ok(pool)
    }

    /// Queues a page. A page still queued after `max_queue_wait` is refused as Busy, however
    /// long the renders ahead of it take; one a renderer took runs to its deadline.
    pub async fn render(&self, request: PageRequest) -> Result<Page, RenderError> {
        let shared = &self.shared;
        let (reply, mut answer) = oneshot::channel();
        let id = shared.next_job.fetch_add(1, Ordering::Relaxed);
        {
            let mut queue = lock(&shared.queue);
            if shared.down.load(Ordering::SeqCst) {
                return Err(RenderError::Down);
            }
            if queue.len() >= shared.policy.queue_capacity {
                drop(queue);
                return Err(self.refuse());
            }
            queue.push_back(Job {
                id,
                request,
                queued: Instant::now(),
                reply,
            });
        }
        shared.ready.notify_one();
        let queued = Queued { shared, id };
        self.grow();
        let answer = match tokio::time::timeout(shared.policy.max_queue_wait, &mut answer).await {
            Ok(answer) => answer,
            Err(_) if queued.withdraw() => return Err(self.refuse()),
            Err(_) => answer.await,
        };
        answer.map_err(|_| RenderError::Failed("The renderer stopped".into()))?
    }

    fn refuse(&self) -> RenderError {
        #[cfg(feature = "bench")]
        self.shared.refused.fetch_add(1, Ordering::Relaxed);
        RenderError::Busy
    }

    // Adds a renderer while more pages wait than renderers are free, and memory allows, one
    // at a time. A free renderer may not have taken the page just sent yet.
    fn grow(&self) {
        let shared = &self.shared;
        let renderers = shared.renderers.load(Ordering::SeqCst);
        let free = renderers.saturating_sub(shared.busy.load(Ordering::SeqCst));
        if self.stats().queued <= free
            || shared.pressure.load(Ordering::Relaxed)
            || shared.renderers.load(Ordering::SeqCst) >= shared.policy.max_renderers
            || shared.spawning.swap(true, Ordering::SeqCst)
        {
            return;
        }
        shared.renderers.fetch_add(1, Ordering::SeqCst);
        if spawn_renderer(shared).is_err() {
            shared.renderers.fetch_sub(1, Ordering::SeqCst);
            shared.spawning.store(false, Ordering::SeqCst);
        }
    }

    /// Under memory pressure, renderers collect after every page, extra ones stop, and none
    /// are added.
    pub fn set_pressure(&self, pressure: bool) {
        self.shared.pressure.store(pressure, Ordering::Relaxed);
    }

    pub fn stats(&self) -> Stats {
        Stats {
            renderers: self.shared.renderers.load(Ordering::SeqCst),
            queued: lock(&self.shared.queue).len(),
            #[cfg(feature = "bench")]
            refused: self.shared.refused.load(Ordering::Relaxed),
        }
    }

    pub fn health(&self) -> Health {
        let shared = &self.shared;
        if shared.down.load(Ordering::SeqCst) {
            Health::Down
        } else if recent_crashes(shared).is_empty() {
            Health::Ready
        } else {
            Health::Degraded
        }
    }
}

// A caller's page while it may still be queued; dropping the caller withdraws it.
struct Queued<'a> {
    shared: &'a Shared,
    id: u64,
}
impl Queued<'_> {
    // True if the page was still queued, so no renderer will take it.
    fn withdraw(&self) -> bool {
        let mut queue = lock(&self.shared.queue);
        match queue.iter().position(|job| job.id == self.id) {
            Some(index) => {
                queue.remove(index);
                true
            }
            None => false,
        }
    }
}
impl Drop for Queued<'_> {
    fn drop(&mut self) {
        self.withdraw();
    }
}

fn recent_crashes(shared: &Shared) -> MutexGuard<'_, VecDeque<Instant>> {
    let mut crashes = lock(&shared.crashes);
    while crashes
        .front()
        .is_some_and(|at| at.elapsed() > shared.policy.restart_window)
    {
        crashes.pop_front();
    }
    crashes
}

fn spawn_renderer(shared: &Arc<Shared>) -> Result<(), String> {
    // Held while spawning, so the supervisor finds the handle when the thread exits.
    let mut threads = lock(&shared.threads);
    let id = shared.next_thread.fetch_add(1, Ordering::Relaxed);
    let worker = shared.clone();
    let handle = std::thread::Builder::new()
        .name("snowtime-render".into())
        .spawn(move || {
            let _exit = ExitNotice(worker.clone(), id);
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("a current-thread runtime builds");
            runtime.block_on(run_renderer(worker));
        })
        .map_err(|e| e.to_string())?;
    threads.insert(id, handle);
    Ok(())
}

// Tells the supervisor that a renderer thread ended, also when it unwinds from a panic.
struct ExitNotice(Arc<Shared>, u64);
impl Drop for ExitNotice {
    fn drop(&mut self) {
        let _ = self.0.exits.send(Exit::Thread(self.1));
    }
}

// Joins renderer threads as they end. One that panicked is replaced while the restart budget
// allows; past it the pool is down and the pages still queued are answered.
fn supervise(shared: Arc<Shared>, exited: std::sync::mpsc::Receiver<Exit>) {
    let mut closing = false;
    for exit in exited {
        match exit {
            Exit::Closed => closing = true,
            Exit::Thread(id) => {
                let handle = lock(&shared.threads).remove(&id);
                if handle.is_some_and(|thread| thread.join().is_err()) {
                    replace_crashed(&shared);
                }
            }
        }
        if closing && lock(&shared.threads).is_empty() {
            break;
        }
    }
}

fn replace_crashed(shared: &Arc<Shared>) {
    shared.renderers.fetch_sub(1, Ordering::SeqCst);
    // The thread may have panicked while starting.
    shared.spawning.store(false, Ordering::SeqCst);
    if shared.closed.load(Ordering::SeqCst) {
        return;
    }
    let within_budget = {
        let mut crashes = recent_crashes(shared);
        crashes.push_back(Instant::now());
        crashes.len() <= shared.policy.restart_budget
    };
    if within_budget {
        shared.renderers.fetch_add(1, Ordering::SeqCst);
        if spawn_renderer(shared).is_ok() {
            return;
        }
        shared.renderers.fetch_sub(1, Ordering::SeqCst);
    }
    let drained: Vec<Job> = {
        let mut queue = lock(&shared.queue);
        shared.down.store(true, Ordering::SeqCst);
        queue.drain(..).collect()
    };
    shared.ready.notify_waiters();
    for job in drained {
        let _ = job.reply.send(Err(RenderError::Down));
    }
}

enum Next {
    Job(Job),
    Idle,
    Stop,
}

async fn next_job(shared: &Shared, wait: Duration) -> Next {
    let deadline = tokio::time::Instant::now() + wait;
    loop {
        // Registered before the checks, so a page queued in between still wakes this one.
        let notified = shared.ready.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if shared.closed.load(Ordering::SeqCst) || shared.down.load(Ordering::SeqCst) {
            return Next::Stop;
        }
        if let Some(job) = lock(&shared.queue).pop_front() {
            return Next::Job(job);
        }
        if tokio::time::timeout_at(deadline, notified).await.is_err() {
            return Next::Idle;
        }
    }
}

struct Counted<'a>(&'a AtomicUsize);
impl<'a> Counted<'a> {
    fn new(counter: &'a AtomicUsize) -> Self {
        counter.fetch_add(1, Ordering::SeqCst);
        Self(counter)
    }
}
impl Drop for Counted<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
const PANIC_URL: &str = "test:panic";

async fn run_renderer(shared: Arc<Shared>) {
    let policy = &shared.policy;
    let mut renderer = Renderer::new(shared.send.clone(), shared.manifest.clone(), policy.clone());
    shared.spawning.store(false, Ordering::SeqCst);
    let mut dirty = false;
    let mut idle_since = Instant::now();
    let mut untrimmed = 0;
    loop {
        let wait = if dirty {
            policy.idle
        } else {
            policy.retire_after
        };
        let job = match next_job(&shared, wait).await {
            Next::Job(job) => job,
            Next::Stop => {
                shared.renderers.fetch_sub(1, Ordering::SeqCst);
                break;
            }
            Next::Idle if dirty => {
                renderer.collect();
                dirty = false;
                continue;
            }
            Next::Idle if retire(&shared, idle_since) => break,
            Next::Idle => continue,
        };
        #[cfg(test)]
        if job.request.url == PANIC_URL {
            panic!("a test renderer panics");
        }
        // The client is gone, or waited too long: keep the renderer for pages still wanted.
        if job.reply.is_closed() {
            continue;
        }
        if job.queued.elapsed() > policy.max_queue_wait {
            #[cfg(feature = "bench")]
            shared.refused.fetch_add(1, Ordering::Relaxed);
            let _ = job.reply.send(Err(RenderError::Busy));
            continue;
        }
        let busy = Counted::new(&shared.busy);
        #[cfg(feature = "bench")]
        let queue_ms = job.queued.elapsed().as_secs_f64() * 1000.0;
        #[cfg(feature = "bench")]
        let cpu = cpu_ms();
        let mut reply = job.reply;
        let page = renderer.render(&job.request, reply.closed()).await;
        #[cfg(feature = "bench")]
        let page = page.map(|mut p| {
            p.headers.push((
                "server-timing".into(),
                format!(
                    "render_queue;dur={queue_ms:.3}, render_cpu;dur={:.3}",
                    cpu_ms() - cpu
                ),
            ));
            p
        });
        drop(busy);
        let _ = reply.send(page);
        dirty = true;
        idle_since = Instant::now();
        let pressure = shared.pressure.load(Ordering::Relaxed);
        untrimmed += 1;
        if pressure || renderer.old_generation_bytes() > policy.collect_heap_bytes {
            renderer.collect();
            dirty = false;
            untrimmed = 0;
        } else if untrimmed >= TRIM_EVERY_PAGES {
            trim();
            untrimmed = 0;
        }
        if pressure && retire(&shared, idle_since) {
            break;
        }
    }
}

// Stops this renderer if another remains and it is idle past retire_after or under pressure.
fn retire(shared: &Shared, idle_since: Instant) -> bool {
    let pressure = shared.pressure.load(Ordering::Relaxed);
    if !pressure && idle_since.elapsed() < shared.policy.retire_after {
        return false;
    }
    shared
        .renderers
        .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
            (n > shared.policy.min_renderers.max(1)).then(|| n - 1)
        })
        .is_ok()
}

#[cfg(feature = "bench")]
fn cpu_ms() -> f64 {
    #[cfg(target_os = "linux")]
    {
        let mut t = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // Only this renderer's CPU, excluding the host's in-process API worker threads.
        unsafe {
            libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t);
        }
        t.tv_sec as f64 * 1000.0 + t.tv_nsec as f64 / 1e6
    }
    #[cfg(not(target_os = "linux"))]
    {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page() -> PageRequest {
        PageRequest {
            url: "http://localhost/lumen/timer".into(),
            method: "GET".into(),
            headers: vec![],
            cookie: "session=test".into(),
            nonce: "test-nonce".into(),
            locale: Some("en".into()),
            now: None,
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn web_apis_host_contract_and_recovery() {
        let send: SendApi = Arc::new(|request| {
            Box::pin(async move {
                assert_eq!(request.method, "POST");
                assert_eq!(request.path, "/api/v1/example?q=%C3%B5");
                assert_eq!(
                    request.headers,
                    vec![("cookie".into(), "session=test".into())]
                );
                assert_eq!(request.body, "õ".as_bytes());
                Ok(ApiResponse {
                    status: 201,
                    headers: vec![("x-answer".into(), "yes".into())],
                    body: "õ".as_bytes().to_vec(),
                })
            })
        });
        let policy = Policy {
            deadline: Duration::from_millis(200),
            max_page_bytes: 16,
            ..Default::default()
        };
        let mut renderer = Renderer::new(send, r#"{"routes":{}}"#.into(), policy);
        renderer.js().execute_script("test.js", r#"
            renderPage = async function () {
              if (!globalThis.renderManifest.routes) throw Error('manifest');
              const encoded = new TextEncoder().encode('õ');
              const into = new Uint8Array(2);
              if (new TextEncoder().encodeInto('õ', into).written !== 2) throw Error('encodeInto');
              const request = new Request('https://example.com', { method:'POST', body: encoded });
              const decoded = new TextDecoder().decode(await request.arrayBuffer());
              if (decoded !== 'õ' || structuredClone({ text: decoded }).text !== 'õ') throw Error('encoding');
              const path = new URL('/api/v1/example?q=õ', 'https://example.com').pathname + '?' + new URLSearchParams({q:'õ'});
              const answer = await Deno.core.ops.op_send({method:'POST', path, headers:[['cookie','session=test']], body:[...encoded]});
              const response = new Response(new Uint8Array(answer.body), {status:answer.status, headers:answer.headers});
              if (response.headers.get('x-answer') !== 'yes' || await response.text() !== 'õ') throw Error('response');
              Deno.core.ops.op_head(201, [['x-test','stream']]);
              const stream = new ReadableStream({ start(c) { c.enqueue(encoded); c.enqueue(encoded); c.close(); } });
              for await (const chunk of stream) Deno.core.ops.op_chunk(chunk);
            }
        "#).unwrap();
        let rendered = renderer
            .render(&page(), std::future::pending())
            .await
            .unwrap();
        assert_eq!(rendered.status, 201);
        assert_eq!(rendered.body, "õõ".as_bytes());

        let pending: SendApi = Arc::new(|_| Box::pin(std::future::pending()));
        renderer.js().op_state().borrow_mut().put(pending);
        renderer
            .js()
            .execute_script(
                "pending.js",
                "renderPage = async () => { await Deno.core.ops.op_send({method:'GET',path:'/pending',headers:[],body:[]}) }",
            )
            .unwrap();
        assert!(matches!(
            renderer.render(&page(), std::future::pending()).await,
            Err(RenderError::Failed(message)) if message.contains("deadline")
        ));

        let recovered = "renderPage = async () => Deno.core.ops.op_head(204, [])";
        for failing in [
            "renderPage = async () => { for (;;) {} }",
            "renderPage = async () => { throw Error('test failure') }",
            "renderPage = async () => { Deno.core.ops.op_head(200, []); Deno.core.ops.op_chunk(new Uint8Array(17)) }",
        ] {
            renderer.js().execute_script("failing.js", failing).unwrap();
            assert!(
                renderer
                    .render(&page(), std::future::pending())
                    .await
                    .is_err(),
                "{failing}"
            );
            renderer
                .js()
                .execute_script("recovered.js", recovered)
                .unwrap();
            assert_eq!(
                renderer
                    .render(&page(), std::future::pending())
                    .await
                    .unwrap()
                    .status,
                204
            );
        }

        renderer.policy.replace_heap_bytes = 0;
        renderer
            .js()
            .execute_script("marker.js", "globalThis.renderMarker = 'discard me'")
            .unwrap();
        renderer.collect();
        renderer.js().execute_script("fresh.js", "if (globalThis.renderMarker !== undefined) throw Error('Isolate was not replaced')").unwrap();
    }

    // An API call that never answers, reporting when it is made and when it is dropped.
    fn stuck_api() -> (SendApi, tokio::sync::mpsc::UnboundedReceiver<&'static str>) {
        struct Dropped(tokio::sync::mpsc::UnboundedSender<&'static str>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                let _ = self.0.send("dropped");
            }
        }
        let (events, received) = tokio::sync::mpsc::unbounded_channel();
        let send: SendApi = Arc::new(move |_| {
            let _ = events.send("called");
            let dropped = Dropped(events.clone());
            Box::pin(async move {
                let _dropped = dropped;
                std::future::pending().await
            })
        });
        (send, received)
    }

    async fn started(policy: Policy, send: SendApi) -> Pool {
        let pool = Pool::start(send, r#"{"routes":{}}"#, policy).unwrap();
        // Let the renderer create its isolate, so the first page doesn't wait in the queue.
        tokio::time::sleep(Duration::from_millis(500)).await;
        pool
    }

    fn spawn(
        pool: &Pool,
        request: PageRequest,
    ) -> tokio::task::JoinHandle<Result<Page, RenderError>> {
        let pool = pool.clone();
        tokio::spawn(async move { pool.render(request).await })
    }

    async fn next(events: &mut tokio::sync::mpsc::UnboundedReceiver<&'static str>) -> &'static str {
        tokio::time::timeout(Duration::from_secs(1), events.recv())
            .await
            .expect("an API event within a second")
            .unwrap()
    }

    #[tokio::test(flavor = "current_thread")]
    async fn refuses_a_page_queued_behind_a_stuck_render_near_max_queue_wait() {
        let (send, mut events) = stuck_api();
        let policy = Policy {
            deadline: Duration::from_secs(3),
            ..Default::default()
        };
        let pool = started(policy, send).await;
        let first = spawn(&pool, page());
        assert_eq!(next(&mut events).await, "called");
        let queued = Instant::now();
        assert!(matches!(pool.render(page()).await, Err(RenderError::Busy)));
        let waited = queued.elapsed();
        assert!(
            waited >= Duration::from_millis(950) && waited < Duration::from_millis(1500),
            "refused after {waited:?}"
        );
        assert_eq!(pool.stats().queued, 0);
        // The render deadline replaces the isolate, which drops the page's API call.
        assert!(matches!(first.await.unwrap(), Err(RenderError::Failed(_))));
        assert_eq!(next(&mut events).await, "dropped");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn refuses_when_full_and_reclaims_cancelled_pages_at_once() {
        let (send, mut events) = stuck_api();
        let policy = Policy {
            queue_capacity: 1,
            ..Default::default()
        };
        let pool = started(policy, send).await;
        let first = spawn(&pool, page());
        assert_eq!(next(&mut events).await, "called");
        let second = spawn(&pool, page());
        tokio::task::yield_now().await;
        assert_eq!(pool.stats().queued, 1);
        assert!(matches!(pool.render(page()).await, Err(RenderError::Busy)));
        second.abort();
        assert!(second.await.unwrap_err().is_cancelled());
        assert_eq!(pool.stats().queued, 0, "a cancelled page leaves the queue");
        let third = spawn(&pool, page());
        tokio::task::yield_now().await;
        assert_eq!(pool.stats().queued, 1, "its place is free for another page");

        // Cancelling the page that renders stops it and drops its API call long before the
        // render deadline; the renderer then takes the third page.
        first.abort();
        assert_eq!(next(&mut events).await, "dropped");
        assert_eq!(next(&mut events).await, "called");
        third.abort();
        assert_eq!(next(&mut events).await, "dropped");
        assert_eq!(pool.stats().renderers, 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn restarts_a_panicking_renderer_within_the_budget() {
        let send: SendApi = Arc::new(|_| Box::pin(async { Err("no API".into()) }));
        let policy = Policy {
            restart_budget: 1,
            ..Default::default()
        };
        let pool = started(policy, send).await;
        let panics = || PageRequest {
            url: PANIC_URL.into(),
            ..page()
        };
        assert_eq!(pool.health(), Health::Ready);
        assert!(matches!(
            pool.render(panics()).await,
            Err(RenderError::Failed(_))
        ));
        let served = pool.render(page()).await;
        assert!(
            !matches!(served, Err(RenderError::Busy | RenderError::Down)),
            "the replacement takes pages"
        );
        assert_eq!(pool.stats().renderers, 1);
        assert_eq!(pool.health(), Health::Degraded);

        // A second crash spends the budget: the page queued behind it is answered, and the
        // lane is down.
        let crashing = spawn(&pool, panics());
        let queued = spawn(&pool, page());
        assert!(matches!(
            crashing.await.unwrap(),
            Err(RenderError::Failed(_))
        ));
        assert!(matches!(queued.await.unwrap(), Err(RenderError::Down)));
        assert_eq!(pool.health(), Health::Down);
        assert!(matches!(pool.render(page()).await, Err(RenderError::Down)));
        assert_eq!(pool.stats().renderers, 0);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn isolate_replacements_do_not_spend_the_restart_budget() {
        let (send, _events) = stuck_api();
        let policy = Policy {
            restart_budget: 0,
            deadline: Duration::from_millis(100),
            ..Default::default()
        };
        let pool = started(policy, send).await;
        for _ in 0..3 {
            assert!(matches!(
                pool.render(page()).await,
                Err(RenderError::Failed(_))
            ));
        }
        assert_eq!(pool.health(), Health::Ready);
        assert_eq!(pool.stats().renderers, 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn grows_only_while_pages_wait() {
        // Each API call fails at once, so a page finishes quickly unless the gate holds it.
        let gate = Arc::new(tokio::sync::Semaphore::new(0));
        let held = gate.clone();
        let send: SendApi = Arc::new(move |_| {
            let held = held.clone();
            Box::pin(async move {
                drop(held.acquire().await);
                Err("no API".into())
            })
        });
        let policy = Policy {
            max_renderers: 2,
            ..Default::default()
        };
        let pool = Pool::start(send, r#"{"routes":{}}"#, policy).unwrap();
        tokio::time::sleep(Duration::from_millis(500)).await;
        gate.add_permits(1_000);
        for _ in 0..5 {
            let _ = pool.render(page()).await;
        }
        assert_eq!(pool.stats().renderers, 1, "a free renderer takes each page");

        gate.forget_permits(1_000);
        let first = tokio::spawn({
            let pool = pool.clone();
            async move { pool.render(page()).await }
        });
        tokio::time::sleep(Duration::from_millis(200)).await;
        let second = tokio::spawn({
            let pool = pool.clone();
            async move { pool.render(page()).await }
        });
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(pool.stats().renderers, 2, "a page waits behind a busy one");
        gate.add_permits(1_000);
        let _ = (first.await, second.await);
    }
}
