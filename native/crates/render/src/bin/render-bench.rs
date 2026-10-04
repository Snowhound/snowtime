use snowtime_render::{ApiResponse, PageRequest, Policy, RenderThread, Renderer, SendApi};
use std::{collections::HashMap, sync::Arc, time::Instant};
use tokio::sync::{mpsc, oneshot};

fn rss_mb() -> f64 {
    #[cfg(target_os = "linux")]
    {
        let status = std::fs::read_to_string("/proc/self/status").unwrap();
        let kb: f64 = status
            .lines()
            .find(|s| s.starts_with("VmRSS:"))
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        kb / 1024.0
    }
    #[cfg(not(target_os = "linux"))]
    {
        0.0
    }
}
fn usage() -> (f64, f64) {
    let mut usage = unsafe { std::mem::zeroed::<libc::rusage>() };
    unsafe {
        libc::getrusage(libc::RUSAGE_SELF, &mut usage);
    }
    let cpu = (usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) as f64 * 1000.0
        + (usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) as f64 / 1000.0;
    #[cfg(target_os = "linux")]
    let peak = usage.ru_maxrss as f64 / 1024.0;
    #[cfg(not(target_os = "linux"))]
    let peak = usage.ru_maxrss as f64 / 1048576.0;
    (cpu, peak)
}
async fn drain(mut body: mpsc::Receiver<Result<Vec<u8>, String>>) -> Result<Vec<u8>, String> {
    let mut html = Vec::new();
    while let Some(chunk) = body.recv().await {
        html.extend(chunk?);
    }
    Ok(html)
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    anyhow::ensure!(
        args.len() >= 4,
        "render-bench <local|thread> <page.json> <answers.json|http://host> [count] [output.html]"
    );
    let mode = &args[1];
    let page: PageRequest = serde_json::from_slice(&std::fs::read(&args[2])?)?;
    let send: SendApi = if args[3].starts_with("http") {
        snowtime_render::forward_http(args[3].clone())
    } else {
        let answers: HashMap<String, ApiResponse> =
            serde_json::from_slice(&std::fs::read(&args[3])?)?;
        let answers = Arc::new(answers);
        Arc::new(move |request| {
            let key = format!(
                "{} {} {}",
                request.method,
                request.path,
                String::from_utf8_lossy(&request.body)
            );
            let answer = answers.get(&key).cloned().ok_or_else(|| {
                eprintln!("Unrecorded API request: {key}");
                format!("Unrecorded API request: {key}")
            });
            Box::pin(async move { answer })
        })
    };
    let count: usize = args.get(4).map(|n| n.parse()).transpose()?.unwrap_or(500);
    let policy = Policy::default();
    let started = Instant::now();
    let mut local = (mode == "local").then(|| Renderer::new(send.clone(), policy.clone()));
    let threaded = if mode == "thread" {
        Some(RenderThread::start(send, policy).map_err(anyhow::Error::msg)?)
    } else {
        None
    };
    let startup_ms = started.elapsed().as_secs_f64() * 1000.0;
    let loaded_rss = rss_mb();
    let mut times = Vec::new();
    let mut samples = Vec::new();
    let mut cpu_start = 0.0;
    let mut bytes = 0;
    for index in 0..(50 + count) {
        if index == 50 {
            cpu_start = usage().0;
        }
        let begin = Instant::now();
        let html = if let Some(renderer) = &mut local {
            let (head_tx, head_rx) = oneshot::channel();
            let (body_tx, body_rx) = mpsc::channel(4);
            let (_, collected) = tokio::join!(
                renderer.render(page.clone(), head_tx, body_tx),
                drain(body_rx)
            );
            anyhow::ensure!(
                head_rx.await?.map_err(anyhow::Error::msg)?.status == 200,
                "Unexpected status"
            );
            collected.map_err(anyhow::Error::msg)?
        } else {
            let response = threaded
                .as_ref()
                .unwrap()
                .render(page.clone())
                .await
                .map_err(anyhow::Error::msg)?;
            anyhow::ensure!(response.head.status == 200, "Unexpected status");
            drain(response.body).await.map_err(anyhow::Error::msg)?
        };
        let text = String::from_utf8_lossy(&html);
        anyhow::ensure!(
            !text.contains("This page didn't load") && text.contains("data-hk="),
            "Rendered an error page"
        );
        if index == 0 {
            bytes = html.len();
            if let Some(path) = args.get(5) {
                std::fs::write(path, html)?;
            }
        }
        if index >= 50 {
            times.push(begin.elapsed().as_secs_f64() * 1000.0);
            if index % 25 == 0 {
                samples.push(rss_mb());
            }
        }
    }
    let cpu_ms = (usage().0 - cpu_start) / count as f64;
    let loop_rss = rss_mb();
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    if let Some(renderer) = &mut local {
        renderer.collect();
    }
    let idle_rss = rss_mb();
    times.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::json!({"mode":mode, "page":args[2], "count":count, "bytes":bytes, "startup_ms":startup_ms, "p50_ms":times[count/2], "p95_ms":times[count*95/100], "cpu_ms":cpu_ms, "loaded_rss_mb":loaded_rss, "loop_rss_mb":loop_rss, "idle_rss_mb":idle_rss, "peak_rss_mb":usage().1, "rss_samples_mb":samples})
    );
    Ok(())
}
