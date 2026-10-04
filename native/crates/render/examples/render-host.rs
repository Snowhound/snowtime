//! Framework integration harness, independent of the native HTTP host crates.
use axum::{
    Router,
    body::{Body, Bytes},
    extract::{Request, State},
    response::Response,
};
use http_body_util::BodyExt;
use snowtime_render::{ApiResponse, PageRequest, Policy, RenderThread, Renderer, SendApi};
use std::{collections::HashMap, sync::Arc};
use tokio_stream::{StreamExt, wrappers::ReceiverStream};
use tower::ServiceExt;

struct Worker {
    renderer: Renderer,
    dirty: bool,
    finished: std::time::Instant,
}
type ActixWorker = std::rc::Rc<tokio::sync::Mutex<Worker>>;

#[derive(Clone)]
struct Pages {
    timer: PageRequest,
    week: PageRequest,
}
impl Pages {
    fn get(&self, path: &str) -> PageRequest {
        if path.contains("reports") {
            self.week.clone()
        } else {
            self.timer.clone()
        }
    }
}
async fn fixture(
    State(answers): State<Arc<HashMap<String, ApiResponse>>>,
    request: Request,
) -> Response {
    let (parts, body) = request.into_parts();
    let body = body.collect().await.unwrap().to_bytes();
    let key = format!(
        "{} {} {}",
        parts.method,
        parts.uri,
        String::from_utf8_lossy(&body)
    );
    let Some(answer) = answers.get(&key) else {
        return Response::builder()
            .status(500)
            .body(Body::from("Unrecorded request"))
            .unwrap();
    };
    let mut builder = Response::builder().status(answer.status);
    for (name, value) in &answer.headers {
        if name != "content-length" && name != "transfer-encoding" {
            builder = builder.header(name, value);
        }
    }
    builder.body(Body::from(answer.body.clone())).unwrap()
}
fn in_process(api: Router) -> SendApi {
    Arc::new(move |request| {
        let api = api.clone();
        Box::pin(async move {
            let mut builder = Request::builder()
                .method(request.method.as_str())
                .uri(request.path);
            for (name, value) in request.headers {
                builder = builder.header(name, value);
            }
            let response = api
                .oneshot(
                    builder
                        .body(Body::from(request.body))
                        .map_err(|e| e.to_string())?,
                )
                .await
                .unwrap();
            let status = response.status().as_u16();
            let headers = response
                .headers()
                .iter()
                .map(|(n, v)| (n.to_string(), v.to_str().unwrap().to_owned()))
                .collect();
            let body = response
                .into_body()
                .collect()
                .await
                .map_err(|e| e.to_string())?
                .to_bytes()
                .to_vec();
            Ok(ApiResponse {
                status,
                headers,
                body,
            })
        })
    })
}
async fn axum_page(
    State((renderer, pages)): State<(RenderThread, Pages)>,
    request: Request,
) -> Response {
    match renderer.render(pages.get(request.uri().path())).await {
        Ok(page) => {
            let mut builder = Response::builder().status(page.head.status);
            for (name, value) in page.head.headers {
                builder = builder.header(name, value);
            }
            let stream = ReceiverStream::new(page.body)
                .map(|chunk| chunk.map(Bytes::from).map_err(std::io::Error::other));
            builder.body(Body::from_stream(stream)).unwrap()
        }
        Err(error) => Response::builder()
            .status(500)
            .body(Body::from(error))
            .unwrap(),
    }
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let args: Vec<_> = std::env::args().collect();
    anyhow::ensure!(
        args.len() == 4,
        "render-host <axum|actix> <results-dir> <port>"
    );
    let dir = std::path::Path::new(&args[2]);
    let pages = Pages {
        timer: serde_json::from_slice(&std::fs::read(dir.join("timer.json"))?)?,
        week: serde_json::from_slice(&std::fs::read(dir.join("week.json"))?)?,
    };
    let answers: HashMap<String, ApiResponse> =
        serde_json::from_slice(&std::fs::read(dir.join("answers.json"))?)?;
    let api = Router::new()
        .fallback(fixture)
        .with_state(Arc::new(answers));
    let send = in_process(api);
    let port = args[3].parse::<u16>()?;
    if args[1] == "axum" {
        let renderer = RenderThread::start(send, Policy::default()).map_err(anyhow::Error::msg)?;
        let app = Router::new()
            .fallback(axum_page)
            .with_state((renderer, pages));
        axum::serve(
            tokio::net::TcpListener::bind(("127.0.0.1", port)).await?,
            app,
        )
        .await?;
    } else {
        use actix_web::{App, HttpResponse, HttpServer, web};
        use std::rc::Rc;
        HttpServer::new(move || {
            let renderer = Rc::new(tokio::sync::Mutex::new(Worker {
                renderer: Renderer::new(send.clone(), Policy::default()),
                dirty: false,
                finished: std::time::Instant::now(),
            }));
            let idle = renderer.clone();
            actix_web::rt::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    if let Ok(mut worker) = idle.try_lock()
                        && worker.dirty
                        && worker.finished.elapsed() >= std::time::Duration::from_secs(1)
                    {
                        worker.renderer.collect();
                        worker.dirty = false;
                    }
                }
            });
            App::new()
                .app_data(web::Data::new((renderer, pages.clone())))
                .default_service(web::to(actix_page))
        })
        .workers(1)
        .bind(("127.0.0.1", port))?
        .run()
        .await?;
        async fn actix_page(
            request: actix_web::HttpRequest,
            data: web::Data<(ActixWorker, Pages)>,
        ) -> HttpResponse {
            let (head_tx, head_rx) = tokio::sync::oneshot::channel();
            let (body_tx, body_rx) = tokio::sync::mpsc::channel(4);
            let renderer = data.0.clone();
            let page = data.1.get(request.path());
            actix_web::rt::spawn(async move {
                let mut worker = renderer.lock().await;
                worker.renderer.render(page, head_tx, body_tx).await;
                worker.dirty = true;
                worker.finished = std::time::Instant::now();
            });
            match head_rx.await {
                Ok(Ok(head)) => {
                    let mut response = HttpResponse::build(
                        actix_web::http::StatusCode::from_u16(head.status).unwrap(),
                    );
                    for (name, value) in head.headers {
                        response.append_header((name, value));
                    }
                    response.streaming(ReceiverStream::new(body_rx).map(|chunk| {
                        chunk
                            .map(web::Bytes::from)
                            .map_err(actix_web::error::ErrorInternalServerError)
                    }))
                }
                _ => HttpResponse::InternalServerError().finish(),
            }
        }
    }
    Ok(())
}
