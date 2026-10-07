//! Sizes the renderers from the memory the server may use, and watches its use while it
//! runs. The per-renderer costs are task 081.01's measurements.
use snowtime_render::{Policy, Pool};
use std::time::Duration;

const MIB: u64 = 1 << 20;
// The server's peak RSS with one renderer at a 128 MiB heap limit, its target (219 MiB
// measured at capacity), and what each further renderer adds at its peak, 40-75 MiB
// measured (task 081.01, "Memory").
const FIRST_RENDERER_PEAK: u64 = 256 * MIB;
const EXTRA_RENDERER_PEAK: u64 = 80 * MIB;
// The share of the limit the server plans to use; the rest is headroom for SQLite's cache,
// request buffers, and sign-in's scrypt, 32 MiB each.
const PLANNED_SHARE: f64 = 0.75;
// Semi-space sizes for each renderer, largest first, with what each adds to a renderer's
// peak RSS. A nursery that holds a whole page saves 8-11% CPU a page at 32 MiB and 3-8% at
// 16 MiB (task 081.14). The renderers get the largest that the memory left after sizing
// them allows; without room for either, V8 sizes the young generation itself.
const SEMI_SPACES: [(u64, u64); 2] = [(32 * MIB, 56 * MIB), (16 * MIB, 24 * MIB)];
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
    // Below the first renderer's peak, a 64 MiB heap lowers its peak by about 60 MiB for 26-46%
    // more CPU a page.
    let heap = if planned < FIRST_RENDERER_PEAK {
        64 * MIB
    } else {
        128 * MIB
    } as usize;
    let spare =
        planned.saturating_sub(FIRST_RENDERER_PEAK + (renderers as u64 - 1) * EXTRA_RENDERER_PEAK);
    let semi_space = SEMI_SPACES
        .iter()
        .find(|&&(_, peak)| peak * renderers as u64 <= spare)
        .map(|&(size, _)| size as usize);
    Policy {
        heap_limit_bytes: heap,
        collect_heap_bytes: heap * 3 / 8,
        replace_heap_bytes: heap * 5 / 8,
        semi_space_bytes: semi_space,
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
                tracing::warn!(
                    rss_mib = rss / MIB,
                    limit_mib = limit / MIB,
                    pressure,
                    "memory pressure changed"
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
            (
                p.max_renderers,
                p.heap_limit_bytes as u64 / MIB,
                p.semi_space_bytes.map_or(0, |bytes| bytes as u64 / MIB),
            )
        };
        assert_eq!(sized(256, 4), (1, 64, 0));
        assert_eq!(sized(384, 4), (1, 128, 16));
        assert_eq!(sized(512, 4), (2, 128, 16));
        assert_eq!(sized(1024, 4), (4, 128, 32));
        assert_eq!(sized(2048, 1), (1, 128, 32));
        assert_eq!(sized(2048, 32), (17, 128, 0));
    }
}
