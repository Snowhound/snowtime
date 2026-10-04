//! Renders one captured page through the pool, against recorded API answers, and prints one
//! JSON line: latency, throughput, CPU per render, and memory. `capture.ts` writes its inputs.
//!
//!   render-bench <page.json> <answers.json> [count] [renderers] [concurrency] [output.html]
use snowtime_render::{ApiResponse, MANIFEST, PageRequest, Policy, Pool, SendApi};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::{collections::HashMap, sync::Arc, time::Duration, time::Instant};

fn rss_mb() -> f64 {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    status
        .lines()
        .find(|s| s.starts_with("VmRSS:"))
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|kb| kb.parse::<f64>().ok())
        .map_or(0.0, |kb| kb / 1024.0)
}

// glibc's view of the memory it manages: in use, and freed but kept.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn malloc_mb() -> serde_json::Value {
    let info = unsafe { libc::mallinfo2() };
    let mb = |bytes: usize| bytes as f64 / 1048576.0;
    serde_json::json!({"in_use": mb(info.uordblks + info.hblkhd), "free": mb(info.fordblks)})
}
#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
fn malloc_mb() -> serde_json::Value {
    serde_json::Value::Null
}

fn usage() -> (f64, f64) {
    let mut usage = unsafe { std::mem::zeroed::<libc::rusage>() };
    unsafe {
        libc::getrusage(libc::RUSAGE_SELF, &mut usage);
    }
    let cpu = (usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) as f64 * 1000.0
        + (usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) as f64 / 1000.0;
    // Linux reports the peak in KiB, macOS in bytes.
    let peak = if cfg!(target_os = "linux") {
        usage.ru_maxrss as f64 / 1024.0
    } else {
        usage.ru_maxrss as f64 / 1048576.0
    };
    (cpu, peak)
}

// Renders `count` pages with `concurrency` clients, returning each page's time in ms.
async fn run(
    pool: &Pool,
    page: &PageRequest,
    count: usize,
    concurrency: usize,
) -> anyhow::Result<Vec<f64>> {
    let next = Arc::new(AtomicUsize::new(0));
    let mut clients = Vec::new();
    for _ in 0..concurrency {
        let (pool, page, next) = (pool.clone(), page.clone(), next.clone());
        clients.push(tokio::spawn(async move {
            let mut times = Vec::new();
            while next.fetch_add(1, Ordering::Relaxed) < count {
                let begin = Instant::now();
                match pool.render(page.clone()).await {
                    Ok(page) if page.status == 200 => {}
                    Ok(page) => anyhow::bail!("Status {}", page.status),
                    Err(error) => anyhow::bail!("{error:?}"),
                }
                times.push(begin.elapsed().as_secs_f64() * 1000.0);
            }
            Ok(times)
        }));
    }
    let mut times = Vec::with_capacity(count);
    for client in clients {
        times.extend(client.await??);
    }
    Ok(times)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    anyhow::ensure!(
        args.len() >= 3,
        "render-bench <page.json> <answers.json> [count] [renderers] [concurrency] [output.html]"
    );
    let page: PageRequest = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let answers: HashMap<String, ApiResponse> = serde_json::from_slice(&std::fs::read(&args[2])?)?;
    let count: usize = args.get(3).map(|n| n.parse()).transpose()?.unwrap_or(500);
    let renderers: usize = args.get(4).map(|n| n.parse()).transpose()?.unwrap_or(1);
    let concurrency: usize = args.get(5).map(|n| n.parse()).transpose()?.unwrap_or(1);
    let answers = Arc::new(answers);
    let send: SendApi = Arc::new(move |request| {
        let key = format!(
            "{} {} {}",
            request.method,
            request.path,
            String::from_utf8_lossy(&request.body)
        );
        let answer = answers
            .get(&key)
            .cloned()
            .ok_or_else(|| format!("Unrecorded API request: {key}"));
        Box::pin(async move { answer })
    });
    let started = Instant::now();
    let pool = Pool::start(
        send,
        MANIFEST,
        Policy {
            min_renderers: renderers,
            max_renderers: renderers,
            queue_capacity: concurrency.max(64),
            max_queue_wait: Duration::from_secs(60),
            ..Default::default()
        },
    )
    .map_err(anyhow::Error::msg)?;
    let first = pool
        .render(page.clone())
        .await
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
    let startup_ms = started.elapsed().as_secs_f64() * 1000.0;
    let text = String::from_utf8_lossy(&first.body);
    anyhow::ensure!(
        first.status == 200 && !text.contains("This page didn't load") && text.contains("data-hk="),
        "Rendered an error page"
    );
    if let Some(path) = args.get(6) {
        std::fs::write(path, &first.body)?;
    }
    // Every renderer has rendered once; then idle collection runs.
    run(&pool, &page, 50.max(renderers * 10), renderers).await?;
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let loaded_rss = rss_mb();

    // RSS every quarter second, beside the clients.
    let sampling = Arc::new(AtomicBool::new(true));
    let sampler = std::thread::spawn({
        let sampling = sampling.clone();
        move || {
            let mut samples = Vec::new();
            while sampling.load(Ordering::Relaxed) {
                samples.push((rss_mb() * 10.0).round() / 10.0);
                std::thread::sleep(Duration::from_millis(250));
            }
            samples
        }
    });
    let cpu_start = usage().0;
    let measured = Instant::now();
    let mut times = run(&pool, &page, count, concurrency).await?;
    let seconds = measured.elapsed().as_secs_f64();
    let cpu_ms = (usage().0 - cpu_start) / count as f64;
    sampling.store(false, Ordering::Relaxed);
    let samples = sampler.join().expect("the sampler runs");
    let loop_rss = rss_mb();
    let loop_malloc = malloc_mb();
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let idle_rss = rss_mb();
    times.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::json!({"page": args[1], "count": count, "renderers": renderers,
            "concurrency": concurrency, "bytes": first.body.len(), "startup_ms": startup_ms,
            "pages_per_s": count as f64 / seconds, "p50_ms": times[count / 2],
            "p95_ms": times[count * 95 / 100], "cpu_ms": cpu_ms, "loaded_rss_mb": loaded_rss,
            "loop_rss_mb": loop_rss, "idle_rss_mb": idle_rss, "peak_rss_mb": usage().1,
            "loop_malloc_mb": loop_malloc, "idle_malloc_mb": malloc_mb(),
            "rss_samples_mb": samples})
    );
    Ok(())
}
