//! Sizes the renderers from the memory the server may use, and watches its use while it
//! runs. The per-renderer costs are task 081.01's measurements.
use snowtime_render::{Policy, Pool};
use std::time::Duration;

const MIB: u64 = 1 << 20;
// Peak RSS of the server with one renderer at a 128 MiB heap limit, and what each further
// renderer adds at its peak (task 081.01, "Renderers").
const FIRST_RENDERER_PEAK: u64 = 192 * MIB;
const EXTRA_RENDERER_PEAK: u64 = 96 * MIB;
// The share of the limit the server plans to use; the rest is headroom for SQLite's cache,
// request buffers, and sign-in's scrypt, 32 MiB each.
const PLANNED_SHARE: f64 = 0.75;
// Renderers collect after every page above this share of the limit, and below the lower
// one return to collecting by heap size.
const PRESSURE_ON: f64 = 0.8;
const PRESSURE_OFF: f64 = 0.7;

pub struct Limit {
    pub bytes: u64,
    pub source: &'static str,
}

// The cgroup's memory.max (v2) or memory.limit_in_bytes (v1); "max" or a huge v1 value means
// none is set.
fn cgroup_limit() -> Option<u64> {
    [
        "/sys/fs/cgroup/memory.max",
        "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    ]
    .iter()
    .find_map(|path| {
        std::fs::read_to_string(path)
            .ok()?
            .trim()
            .parse::<u64>()
            .ok()
    })
    .filter(|&bytes| bytes < 1 << 50)
}

fn physical_memory() -> u64 {
    // sysconf only reads configuration.
    let (pages, size) = unsafe {
        (
            libc::sysconf(libc::_SC_PHYS_PAGES),
            libc::sysconf(libc::_SC_PAGESIZE),
        )
    };
    (pages.max(0) as u64) * (size.max(0) as u64)
}

pub fn limit() -> Limit {
    match cgroup_limit() {
        Some(bytes) => Limit {
            bytes,
            source: "cgroup",
        },
        None => Limit {
            bytes: physical_memory(),
            source: "physical memory",
        },
    }
}

/// How many renderers memory and CPUs allow, at least one, and each isolate's heap limits.
pub fn policy(limit: &Limit, cpus: usize, at_most: Option<usize>) -> Policy {
    let planned = (limit.bytes as f64 * PLANNED_SHARE) as u64;
    let extra = planned.saturating_sub(FIRST_RENDERER_PEAK) / EXTRA_RENDERER_PEAK;
    let renderers = (1 + extra as usize)
        .min(cpus)
        .min(at_most.unwrap_or(usize::MAX))
        .max(1);
    // Below the first renderer's peak, a smaller heap keeps one renderer within the limit.
    let heap = if planned < FIRST_RENDERER_PEAK {
        64 * MIB
    } else {
        128 * MIB
    } as usize;
    Policy {
        heap_limit_bytes: heap,
        collect_heap_bytes: heap * 3 / 8,
        replace_heap_bytes: heap * 5 / 8,
        max_renderers: renderers,
        ..Default::default()
    }
}

// The process's resident memory, where /proc has it.
fn resident() -> Option<u64> {
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
    let size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    Some(pages * size.max(0) as u64)
}

/// Each second, puts the pool under pressure while the server's RSS is near the limit. Where
/// /proc is missing (macOS), the startup sizing stands alone.
pub fn watch(pool: Pool, limit: u64) {
    if resident().is_none() {
        return;
    }
    tokio::spawn(async move {
        let mut pressure = false;
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let Some(rss) = resident() else { return };
            let share = rss as f64 / limit as f64;
            let next = if pressure {
                share > PRESSURE_OFF
            } else {
                share > PRESSURE_ON
            };
            if next != pressure {
                pressure = next;
                pool.set_pressure(pressure);
                eprintln!(
                    "[memory] {} MiB of {} MiB: {}",
                    rss / MIB,
                    limit / MIB,
                    if pressure {
                        "under pressure"
                    } else {
                        "pressure over"
                    }
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_renderers_from_memory() {
        let sized = |mib: u64, cpus| {
            let p = policy(
                &Limit {
                    bytes: mib * MIB,
                    source: "test",
                },
                cpus,
                None,
            );
            (p.max_renderers, p.heap_limit_bytes as u64 / MIB)
        };
        assert_eq!(sized(200, 4), (1, 64));
        assert_eq!(sized(256, 4), (1, 128));
        assert_eq!(sized(512, 4), (3, 128));
        assert_eq!(sized(2048, 1), (1, 128));
        assert_eq!(sized(2048, 16), (15, 128));
    }
}
