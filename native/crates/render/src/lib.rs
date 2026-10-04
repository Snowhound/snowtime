//! A pool of V8 renderers, each on a thread of its own. The host supplies the app's JSON API
//! by path; a page comes back whole, so a slow client never holds a renderer.
mod deadline;
mod extensions;

use deno_core::{JsRuntime, OpState, RuntimeOptions, op2};
use deno_error::JsErrorBox;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Instant;
use std::{cell::RefCell, future::Future, pin::Pin, rc::Rc, sync::Arc, time::Duration};
use tokio::sync::{Mutex, mpsc, oneshot};

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
    /// The render threw, ran past its deadline, or outgrew the page limit.
    Failed(String),
}

#[derive(Clone, Debug)]
pub struct Policy {
    /// Collect after this long without a page.
    pub idle: Duration,
    /// V8's heap limit; past it, the page fails and the isolate is replaced.
    pub heap_limit_bytes: usize,
    /// Collect after a page that leaves more than this in use.
    pub collect_heap_bytes: usize,
    /// Replace the isolate when a collection leaves more than this live.
    pub replace_heap_bytes: usize,
    pub deadline: Duration,
    pub queue_capacity: usize,
    /// A page that waited longer than this is refused as Busy instead of rendered.
    pub max_queue_wait: Duration,
    pub max_page_bytes: usize,
    pub min_renderers: usize,
    pub max_renderers: usize,
    /// An extra renderer idle this long stops.
    pub retire_after: Duration,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            idle: Duration::from_secs(1),
            heap_limit_bytes: 128 << 20,
            collect_heap_bytes: 48 << 20,
            replace_heap_bytes: 80 << 20,
            deadline: Duration::from_secs(5),
            queue_capacity: 64,
            max_queue_wait: Duration::from_secs(1),
            max_page_bytes: 8 << 20,
            min_renderers: 1,
            max_renderers: 1,
            retire_after: Duration::from_secs(30),
        }
    }
}

#[derive(Default)]
struct Output {
    head: Option<(u16, Headers)>,
    body: Vec<u8>,
    limit: usize,
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
            startup_snapshot: Some(include_bytes!(concat!(env!("OUT_DIR"), "/render.bin"))),
            extensions: exts,
            create_params: Some(
                deno_core::v8::CreateParams::default().heap_limits(0, policy.heap_limit_bytes),
            ),
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
        Self {
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
        drop(self.runtime.take());
        *self = Self::new(
            self.send.clone(),
            self.manifest.clone(),
            self.policy.clone(),
        );
    }
    fn heap_bytes(&mut self) -> usize {
        self.js()
            .v8_isolate()
            .get_heap_statistics()
            .used_heap_size()
    }
    fn collect(&mut self) {
        self.js().v8_isolate().low_memory_notification();
        trim();
        if self.heap_bytes() > self.policy.replace_heap_bytes {
            self.reset();
        }
    }
    async fn render(&mut self, request: &PageRequest) -> Result<Page, String> {
        let limit = self.policy.max_page_bytes;
        self.js().op_state().borrow_mut().put(Output {
            limit,
            ..Default::default()
        });
        let isolate = self.js().v8_isolate().thread_safe_handle();
        self.deadline.arm(self.policy.deadline, isolate);
        let result = tokio::time::timeout(self.policy.deadline, async {
            let value = self.js().execute_script(
                "page.js",
                format!("renderPage({})", serde_json::to_string(request)?),
            )?;
            let promise = self.js().resolve(value);
            self.js()
                .with_event_loop_promise(promise, Default::default())
                .await?;
            Ok::<(), anyhow::Error>(())
        })
        .await
        .unwrap_or_else(|_| Err(anyhow::anyhow!("Render deadline exceeded")));
        self.deadline.disarm();
        let output = self.js().op_state().borrow_mut().take::<Output>();
        match (result, output.head) {
            (Ok(()), Some((status, headers))) => Ok(Page {
                status,
                headers,
                body: output.body,
            }),
            (result, _) => {
                // A failed render may leave locale, timers, or query work behind.
                self.reset();
                Err(result
                    .err()
                    .map_or("The page sent no head".into(), |e| e.to_string()))
            }
        }
    }
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
    request: PageRequest,
    queued: Instant,
    reply: oneshot::Sender<Result<Page, RenderError>>,
}

struct Shared {
    jobs: Mutex<mpsc::Receiver<Job>>,
    send: SendApi,
    manifest: Arc<str>,
    policy: Policy,
    renderers: AtomicUsize,
    spawning: AtomicBool,
    pressure: AtomicBool,
}

/// The renderers and their shared queue. Clones share them.
#[derive(Clone)]
pub struct Pool {
    jobs: mpsc::Sender<Job>,
    shared: Arc<Shared>,
}

pub struct Stats {
    pub renderers: usize,
    pub queued: usize,
}

impl Pool {
    /// Starts `min_renderers` renderers. `manifest` is the client manifest of the build whose
    /// assets the host serves.
    pub fn start(send: SendApi, manifest: &str, policy: Policy) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel(policy.queue_capacity);
        let pool = Pool {
            jobs: tx,
            shared: Arc::new(Shared {
                jobs: Mutex::new(rx),
                send,
                manifest: manifest.into(),
                renderers: AtomicUsize::new(0),
                spawning: AtomicBool::new(false),
                pressure: AtomicBool::new(false),
                policy,
            }),
        };
        for _ in 0..pool.shared.policy.min_renderers.max(1) {
            pool.shared.renderers.fetch_add(1, Ordering::SeqCst);
            spawn_renderer(pool.shared.clone())?;
        }
        Ok(pool)
    }

    pub async fn render(&self, request: PageRequest) -> Result<Page, RenderError> {
        let (reply, answer) = oneshot::channel();
        let job = Job {
            request,
            queued: Instant::now(),
            reply,
        };
        self.jobs.try_send(job).map_err(|_| RenderError::Busy)?;
        self.grow();
        answer
            .await
            .map_err(|_| RenderError::Failed("The renderer stopped".into()))?
    }

    // Adds a renderer while pages wait and memory allows, one at a time.
    fn grow(&self) {
        let shared = &self.shared;
        if self.stats().queued == 0
            || shared.pressure.load(Ordering::Relaxed)
            || shared.renderers.load(Ordering::SeqCst) >= shared.policy.max_renderers
            || shared.spawning.swap(true, Ordering::SeqCst)
        {
            return;
        }
        shared.renderers.fetch_add(1, Ordering::SeqCst);
        if spawn_renderer(shared.clone()).is_err() {
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
            queued: self.jobs.max_capacity() - self.jobs.capacity(),
        }
    }
}

fn spawn_renderer(shared: Arc<Shared>) -> Result<(), String> {
    std::thread::Builder::new()
        .name("snowtime-render".into())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("a current-thread runtime builds");
            runtime.block_on(run_renderer(shared));
        })
        .map(drop)
        .map_err(|e| e.to_string())
}

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
        let job = {
            let mut jobs = shared.jobs.lock().await;
            tokio::time::timeout(wait, jobs.recv()).await
        };
        let job = match job {
            Ok(Some(job)) => job,
            Ok(None) => break,
            Err(_) if dirty => {
                renderer.collect();
                dirty = false;
                continue;
            }
            Err(_) if retire(&shared, idle_since) => break,
            Err(_) => continue,
        };
        // The client is gone, or waited too long: keep the renderer for pages still wanted.
        if job.reply.is_closed() {
            continue;
        }
        if job.queued.elapsed() > policy.max_queue_wait {
            let _ = job.reply.send(Err(RenderError::Busy));
            continue;
        }
        let page = renderer.render(&job.request).await;
        let _ = job.reply.send(page.map_err(RenderError::Failed));
        dirty = true;
        idle_since = Instant::now();
        let pressure = shared.pressure.load(Ordering::Relaxed);
        untrimmed += 1;
        if pressure || renderer.heap_bytes() > policy.collect_heap_bytes {
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
        let rendered = renderer.render(&page()).await.unwrap();
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
        assert!(
            renderer
                .render(&page())
                .await
                .unwrap_err()
                .contains("deadline")
        );

        let recovered = "renderPage = async () => Deno.core.ops.op_head(204, [])";
        for failing in [
            "renderPage = async () => { for (;;) {} }",
            "renderPage = async () => { throw Error('test failure') }",
            "renderPage = async () => { Deno.core.ops.op_head(200, []); Deno.core.ops.op_chunk(new Uint8Array(17)) }",
        ] {
            renderer.js().execute_script("failing.js", failing).unwrap();
            assert!(renderer.render(&page()).await.is_err(), "{failing}");
            renderer
                .js()
                .execute_script("recovered.js", recovered)
                .unwrap();
            assert_eq!(renderer.render(&page()).await.unwrap().status, 204);
        }

        renderer.policy.replace_heap_bytes = 0;
        renderer
            .js()
            .execute_script("marker.js", "globalThis.renderMarker = 'discard me'")
            .unwrap();
        renderer.collect();
        renderer.js().execute_script("fresh.js", "if (globalThis.renderMarker !== undefined) throw Error('Isolate was not replaced')").unwrap();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn refuses_when_full_or_waited_too_long() {
        // The bundle's first API call never answers, so each page holds its renderer until
        // the deadline.
        let send: SendApi = Arc::new(|_| Box::pin(std::future::pending()));
        let policy = Policy {
            queue_capacity: 1,
            deadline: Duration::from_millis(600),
            max_queue_wait: Duration::from_millis(200),
            ..Default::default()
        };
        let pool = Pool::start(send, r#"{"routes":{}}"#, policy).unwrap();
        // Let the renderer create its isolate, so the first page doesn't wait in the queue.
        tokio::time::sleep(Duration::from_millis(500)).await;
        let spawn = |pool: &Pool| {
            let pool = pool.clone();
            tokio::spawn(async move { pool.render(page()).await })
        };
        let first = spawn(&pool);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let second = spawn(&pool);
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(matches!(pool.render(page()).await, Err(RenderError::Busy)));
        assert!(matches!(first.await.unwrap(), Err(RenderError::Failed(_))));
        assert!(matches!(second.await.unwrap(), Err(RenderError::Busy)));
        assert_eq!(pool.stats().renderers, 1);
    }
}
