//! Renders one captured page through the pool, against recorded API answers, and prints one
//! JSON line: latency, throughput, CPU per render, and memory. `capture.ts` writes its inputs.
//!
//!   render-bench <page.json> <answers.json> [count] [renderers] [concurrency] [output.html]
//!
//! RENDER_HEAP_MB sets each isolate's heap limit, RENDER_SEMI_MB its semi-space size, and
//! V8_FLAGS passes flags to V8.
//! `thread_cpu_ms` splits the measured CPU by thread: the renderer, and V8's GC and compiler
//! workers.
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

// perf record starts disabled; its acknowledgement bounds all-thread sampling to the loop.
fn perf_control(command: &str) -> anyhow::Result<()> {
    use std::io::{BufRead, Write};
    if let Ok(path) = std::env::var("RENDER_PERF_CONTROL") {
        let mut control = std::fs::OpenOptions::new().write(true).open(path)?;
        writeln!(control, "{command}")?;
        if let Ok(path) = std::env::var("RENDER_PERF_ACK") {
            let ack = std::fs::File::open(path)?;
            let mut line = String::new();
            std::io::BufReader::new(ack).read_line(&mut line)?;
            anyhow::ensure!(line.trim() == "ack", "perf did not acknowledge {command}");
        }
    }
    Ok(())
}

fn cgroup_cpu_us() -> Option<f64> {
    std::fs::read_to_string("/sys/fs/cgroup/cpu.stat")
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix("usage_usec "))?
        .parse()
        .ok()
}

// RENDER_HEAP_MB sets the heap limit, with the host's thresholds for it (crates/host), and
// RENDER_SEMI_MB the semi-space size.
fn heap_limits() -> Policy {
    let mb = |name| {
        std::env::var(name)
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .map(|mb| mb << 20)
    };
    let policy = Policy {
        semi_space_bytes: mb("RENDER_SEMI_MB"),
        ..Policy::default()
    };
    let Some(heap) = mb("RENDER_HEAP_MB") else {
        return policy;
    };
    Policy {
        heap_limit_bytes: heap,
        collect_heap_bytes: heap * 3 / 8,
        replace_heap_bytes: heap * 5 / 8,
        ..policy
    }
}

// CPU milliseconds per thread name, from /proc/self/task.
fn thread_cpu() -> HashMap<String, f64> {
    let mut by_name = HashMap::new();
    let tick = 1000.0 / unsafe { libc::sysconf(libc::_SC_CLK_TCK) } as f64;
    for task in std::fs::read_dir("/proc/self/task")
        .into_iter()
        .flatten()
        .flatten()
    {
        let path = task.path();
        let name = std::fs::read_to_string(path.join("comm"))
            .unwrap_or_default()
            .trim()
            .to_string();
        let stat = std::fs::read_to_string(path.join("stat")).unwrap_or_default();
        let fields: Vec<&str> = stat
            .rsplit(')')
            .next()
            .unwrap_or("")
            .split_whitespace()
            .collect();
        let user = fields
            .get(11)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0);
        let system = fields
            .get(12)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0);
        *by_name.entry(format!("{name}:user")).or_insert(0.0) += user * tick;
        *by_name.entry(format!("{name}:sys")).or_insert(0.0) += system * tick;
    }
    by_name
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::var_os("RENDER_PERF_PROF").is_some() {
        deno_core::v8::V8::set_flags_from_string("--perf-prof --perf-prof-unwinding-info");
    }
    if let Ok(flags) = std::env::var("V8_FLAGS") {
        deno_core::v8::V8::set_flags_from_string(&flags);
    }
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
            ..heap_limits()
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
    perf_control("enable")?;
    let cgroup_start = cgroup_cpu_us();
    let cpu_start = usage().0;
    let threads_start = thread_cpu();
    let measured = Instant::now();
    let mut times = run(&pool, &page, count, concurrency).await?;
    let seconds = measured.elapsed().as_secs_f64();
    let cpu_ms = (usage().0 - cpu_start) / count as f64;
    let threads: HashMap<String, f64> = thread_cpu()
        .into_iter()
        .map(|(k, v)| {
            let per_render = (v - threads_start.get(&k).copied().unwrap_or(0.0)) / count as f64;
            (k, (per_render * 1000.0).round() / 1000.0)
        })
        .collect();
    let cgroup_cpu_ms = cgroup_start
        .zip(cgroup_cpu_us())
        .map(|(start, end)| (end - start) / 1000.0 / count as f64);
    perf_control("disable")?;
    let collection_cpu = usage().0;
    let collection_started = Instant::now();
    if std::env::var_os("RENDER_CPU_PROFILE").is_some()
        || std::env::var_os("RENDER_ALLOCATION_PROFILE").is_some()
    {
        // Stop and serialize outside the measured loop, before one extra render.
        pool.render(page.clone())
            .await
            .map_err(|e| anyhow::anyhow!("{e:?}"))?;
    }
    let profile_finish_cpu_ms = usage().0 - collection_cpu;
    let profile_finish_ms = collection_started.elapsed().as_secs_f64() * 1000.0;
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
            "p95_ms": times[count * 95 / 100], "cpu_ms": cpu_ms, "thread_cpu_ms": threads, "cgroup_cpu_ms": cgroup_cpu_ms, "loaded_rss_mb": loaded_rss,
            "loop_rss_mb": loop_rss, "idle_rss_mb": idle_rss, "peak_rss_mb": usage().1,
            "loop_malloc_mb": loop_malloc, "idle_malloc_mb": malloc_mb(),
            "rss_samples_mb": samples, "profile_finish_cpu_ms": profile_finish_cpu_ms,
            "profile_finish_ms": profile_finish_ms})
    );
    Ok(())
}
