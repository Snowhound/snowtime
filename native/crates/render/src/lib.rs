//! A thread-owned V8 renderer. The host supplies the app's JSON API by path.
mod deadline;
mod extensions;

use deno_core::{JsRuntime, OpState, RuntimeOptions, op2};
use deno_error::JsErrorBox;
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, future::Future, pin::Pin, rc::Rc, sync::Arc, time::Duration};
use tokio::sync::{mpsc, oneshot};

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
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PageRequest {
    pub url: String,
    pub method: String,
    pub headers: Headers,
    pub cookie: String,
    pub nonce: String,
    pub locale: String,
    pub manifest: serde_json::Value,
    #[serde(default)]
    pub now: Option<i64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PageHead {
    pub status: u16,
    pub headers: Headers,
}
pub struct PageResponse {
    pub head: PageHead,
    pub body: mpsc::Receiver<Result<Vec<u8>, String>>,
}
#[derive(Clone, Debug)]
pub struct Policy {
    pub idle: Duration,
    pub collect_heap_bytes: usize,
    pub replace_heap_bytes: usize,
    pub deadline: Duration,
    pub queue_capacity: usize,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            idle: Duration::from_secs(1),
            collect_heap_bytes: 48 * 1024 * 1024,
            replace_heap_bytes: 80 * 1024 * 1024,
            deadline: Duration::from_secs(5),
            queue_capacity: 8,
        }
    }
}
struct Output {
    head: Option<oneshot::Sender<Result<PageHead, String>>>,
    body: mpsc::Sender<Result<Vec<u8>, String>>,
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
fn op_head(state: &mut OpState, #[serde] head: PageHead) {
    if let Some(tx) = state.borrow_mut::<Output>().head.take() {
        let _ = tx.send(Ok(head));
    }
}
#[op2]
async fn op_chunk(
    state: Rc<RefCell<OpState>>,
    #[buffer(copy)] bytes: Vec<u8>,
) -> Result<(), JsErrorBox> {
    let tx = state.borrow().borrow::<Output>().body.clone();
    tx.send(Ok(bytes))
        .await
        .map_err(|_| JsErrorBox::generic("Page body cancelled"))
}
deno_core::extension!(host, ops = [op_send, op_head, op_chunk]);

/// Used directly on an Actix worker, or by `RenderThread` on its own thread.
/// Only one render runs at a time, through the end of its HTML stream.
pub struct Renderer {
    runtime: Option<JsRuntime>,
    deadline: deadline::Deadline,
    send: SendApi,
    policy: Policy,
}
impl Renderer {
    pub fn new(send: SendApi, policy: Policy) -> Self {
        let mut exts = extensions::extensions();
        exts.push(host::init());
        let mut runtime = JsRuntime::new(RuntimeOptions {
            startup_snapshot: Some(include_bytes!(concat!(env!("OUT_DIR"), "/render.bin"))),
            extensions: exts,
            create_params: Some(
                deno_core::v8::CreateParams::default().heap_limits(0, 128 * 1024 * 1024),
            ),
            ..Default::default()
        });
        let handle = runtime.v8_isolate().thread_safe_handle();
        runtime.add_near_heap_limit_callback(move |limit, _| {
            handle.terminate_execution();
            limit + 16 * 1024 * 1024
        });
        runtime.op_state().borrow_mut().put(send.clone());
        Self {
            runtime: Some(runtime),
            deadline: deadline::Deadline::new(),
            send,
            policy,
        }
    }
    fn reset(&mut self) {
        self.runtime
            .as_mut()
            .unwrap()
            .v8_isolate()
            .cancel_terminate_execution();
        // Dispose this isolate before entering its replacement on the same thread.
        drop(self.runtime.take());
        *self = Self::new(self.send.clone(), self.policy.clone());
    }
    pub fn heap_bytes(&mut self) -> usize {
        self.runtime
            .as_mut()
            .unwrap()
            .v8_isolate()
            .get_heap_statistics()
            .used_heap_size()
    }
    pub fn collect(&mut self) {
        self.runtime
            .as_mut()
            .unwrap()
            .v8_isolate()
            .low_memory_notification();
        if self.heap_bytes() > self.policy.replace_heap_bytes {
            self.reset();
        }
    }
    pub async fn render(
        &mut self,
        request: PageRequest,
        head: oneshot::Sender<Result<PageHead, String>>,
        body: mpsc::Sender<Result<Vec<u8>, String>>,
    ) {
        self.runtime
            .as_mut()
            .unwrap()
            .op_state()
            .borrow_mut()
            .put(Output {
                head: Some(head),
                body: body.clone(),
            });
        self.deadline.arm(
            self.policy.deadline,
            self.runtime
                .as_mut()
                .unwrap()
                .v8_isolate()
                .thread_safe_handle(),
        );
        let result = tokio::time::timeout(self.policy.deadline, async {
            let value = self.runtime.as_mut().unwrap().execute_script(
                "page.js",
                format!("renderPage({})", serde_json::to_string(&request)?),
            )?;
            let promise = self.runtime.as_mut().unwrap().resolve(value);
            self.runtime
                .as_mut()
                .unwrap()
                .with_event_loop_promise(promise, Default::default())
                .await?;
            Ok::<(), anyhow::Error>(())
        })
        .await
        .unwrap_or_else(|_| Err(anyhow::anyhow!("Render deadline exceeded")));
        self.deadline.disarm();
        let output = self
            .runtime
            .as_mut()
            .unwrap()
            .op_state()
            .borrow_mut()
            .take::<Output>();
        if let Err(error) = result {
            let message = error.to_string();
            if let Some(head) = output.head {
                let _ = head.send(Err(message.clone()));
            }
            let _ = tokio::time::timeout(Duration::from_millis(100), body.send(Err(message))).await;
            // A failed render may leave locale, timers, or query work behind.
            self.reset();
        } else if self.heap_bytes() > self.policy.collect_heap_bytes {
            self.collect();
        }
    }
}
struct Job {
    request: PageRequest,
    head: oneshot::Sender<Result<PageHead, String>>,
    body: mpsc::Sender<Result<Vec<u8>, String>>,
}
#[derive(Clone)]
pub struct RenderThread {
    jobs: mpsc::Sender<Job>,
}
impl RenderThread {
    pub fn start(send: SendApi, policy: Policy) -> Result<Self, String> {
        let (tx, mut rx) = mpsc::channel::<Job>(policy.queue_capacity);
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("snowtime-render".into())
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                runtime.block_on(async move {
                    let mut renderer = Renderer::new(send, policy.clone());
                    let _ = ready_tx.send(());
                    let mut dirty = false;
                    loop {
                        let job = if dirty {
                            match tokio::time::timeout(policy.idle, rx.recv()).await {
                                Ok(job) => job,
                                Err(_) => {
                                    renderer.collect();
                                    dirty = false;
                                    continue;
                                }
                            }
                        } else {
                            rx.recv().await
                        };
                        let Some(job) = job else { break };
                        if job.head.is_closed() {
                            continue;
                        }
                        renderer.render(job.request, job.head, job.body).await;
                        dirty = true;
                    }
                });
            })
            .map_err(|e| e.to_string())?;
        ready_rx.recv().map_err(|e| e.to_string())?;
        Ok(Self { jobs: tx })
    }
    pub async fn render(&self, request: PageRequest) -> Result<PageResponse, String> {
        let (head_tx, head_rx) = oneshot::channel();
        let (body_tx, body_rx) = mpsc::channel(4);
        self.jobs
            .send(Job {
                request,
                head: head_tx,
                body: body_tx,
            })
            .await
            .map_err(|_| "Render thread stopped")?;
        let head = head_rx.await.map_err(|_| "Render thread stopped")??;
        Ok(PageResponse {
            head,
            body: body_rx,
        })
    }
}
/// Measurement adapter. Production hosts pass their router instead.
pub fn forward_http(base: String) -> SendApi {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    Arc::new(move |request| {
        let client = client.clone();
        let base = base.clone();
        Box::pin(async move {
            let method = request
                .method
                .parse::<reqwest::Method>()
                .map_err(|e| e.to_string())?;
            let mut call = client.request(method, format!("{base}{}", request.path));
            for (name, value) in request.headers {
                call = call.header(name, value);
            }
            let response = call
                .body(request.body)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let status = response.status().as_u16();
            let headers = response
                .headers()
                .iter()
                .map(|(n, v)| {
                    Ok((
                        n.to_string(),
                        v.to_str().map_err(|e| e.to_string())?.to_owned(),
                    ))
                })
                .collect::<Result<Headers, String>>()?;
            let body = response.bytes().await.map_err(|e| e.to_string())?.to_vec();
            Ok(ApiResponse {
                status,
                headers,
                body,
            })
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn collect(
        renderer: &mut Renderer,
    ) -> (Result<PageHead, String>, Vec<Result<Vec<u8>, String>>) {
        let request = PageRequest {
            url: "http://localhost/lumen/timer".into(),
            method: "GET".into(),
            headers: vec![],
            cookie: "session=test".into(),
            nonce: "test-nonce".into(),
            locale: "en".into(),
            manifest: serde_json::json!({"routes":{}}),
            now: None,
        };
        let (head_tx, head_rx) = oneshot::channel();
        let (body_tx, mut body_rx) = mpsc::channel(1);
        let (_, chunks) = tokio::join!(renderer.render(request, head_tx, body_tx), async {
            let mut chunks = vec![];
            while let Some(chunk) = body_rx.recv().await {
                chunks.push(chunk);
            }
            chunks
        });
        (head_rx.await.unwrap(), chunks)
    }
    #[tokio::test(flavor = "current_thread")]
    async fn web_apis_host_contract_streaming_and_recovery() {
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
            ..Default::default()
        };
        let mut renderer = Renderer::new(send, policy);
        renderer.runtime.as_mut().unwrap().execute_script("test.js", r#"
            renderPage = async function () {
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
              Deno.core.ops.op_head({status:201, headers:[['x-test','stream']]});
              const stream = new ReadableStream({ start(c) { c.enqueue(encoded); c.enqueue(encoded); c.close(); } });
              for await (const chunk of stream) await Deno.core.ops.op_chunk(chunk);
            }
        "#).unwrap();
        let (head, chunks) = collect(&mut renderer).await;
        assert_eq!(head.unwrap().status, 201);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].as_ref().unwrap(), "õ".as_bytes());
        let pending: SendApi = Arc::new(|_| Box::pin(std::future::pending()));
        renderer
            .runtime
            .as_mut()
            .unwrap()
            .op_state()
            .borrow_mut()
            .put(pending);
        renderer
            .runtime
            .as_mut()
            .unwrap()
            .execute_script(
                "pending.js",
                r#"
          renderPage = async () => {
            await Deno.core.ops.op_send({method:'GET',path:'/pending',headers:[],body:[]});
          }
        "#,
            )
            .unwrap();
        assert!(
            collect(&mut renderer)
                .await
                .0
                .unwrap_err()
                .contains("deadline")
        );

        renderer
            .runtime
            .as_mut()
            .unwrap()
            .execute_script("hang.js", "renderPage = async () => { for (;;) {} }")
            .unwrap();
        let (head, _) = collect(&mut renderer).await;
        assert!(head.is_err());
        renderer
            .runtime
            .as_mut()
            .unwrap()
            .execute_script(
                "recovered.js",
                "renderPage = async () => Deno.core.ops.op_head({status:204,headers:[]})",
            )
            .unwrap();
        assert_eq!(collect(&mut renderer).await.0.unwrap().status, 204);
        renderer
            .runtime
            .as_mut()
            .unwrap()
            .execute_script(
                "throws.js",
                "renderPage = async () => { throw Error('test failure') }",
            )
            .unwrap();
        assert!(
            collect(&mut renderer)
                .await
                .0
                .unwrap_err()
                .contains("test failure")
        );
        renderer
            .runtime
            .as_mut()
            .unwrap()
            .execute_script(
                "recovered.js",
                "renderPage = async () => Deno.core.ops.op_head({status:204,headers:[]})",
            )
            .unwrap();
        assert_eq!(collect(&mut renderer).await.0.unwrap().status, 204);
        renderer.policy.collect_heap_bytes = 0;
        renderer.policy.replace_heap_bytes = 0;
        renderer
            .runtime
            .as_mut()
            .unwrap()
            .execute_script("marker.js", "globalThis.renderMarker = 'discard me'")
            .unwrap();
        assert_eq!(collect(&mut renderer).await.0.unwrap().status, 204);
        renderer.runtime.as_mut().unwrap().execute_script("fresh.js", "if (globalThis.renderMarker !== undefined) throw Error('Isolate was not replaced')").unwrap();
    }
}
