# 081.12: Profiles of both servers under load

Status: todo (once the port's features and tests are done, after subtask 10)

So far the work has measured how much each server spends, not where. Subtask 08 profiled
scrypt alone, subtask 01 measured the renderer's heap, subtask 07 took a heap profile of
Caddy, and subtask 10 adds per-request counters behind the `bench` feature. No profile
shows where the native server's CPU and waiting go under load. This subtask takes those
profiles, finds the remaining bottlenecks, and compares them with the TypeScript server's.

## Method

Profile on Linux, at a fixed load that passes its latency targets (from subtask 10), and
again just past capacity. Use the same dataset, recording, and core and memory limits for
both servers, and keep the profiler's own overhead out of the comparison: a run with the
profiler and one without, at the same load.

- **CPU:** whole-process flame graphs of the native server with `perf` or
  `cargo flamegraph`, with frame pointers or DWARF unwinding in the release build. Start
  V8 with `--perf-prof` (or `--perf-basic-prof`) so its JIT frames have names. On macOS,
  `samply` can serve for quick iterations.
- **Waiting:** off-CPU profiles (`perf sched`, or `offcputime` from bcc) for where threads
  block: the connection or the read pool, the blocking queue, the render pool, and I/O.
  `tokio-console` can show task-level waits.
- **Allocation:** `heaptrack` or `dhat` on the Rust code. Task 081 aims at no allocation
  per row on hot paths after the first port; list where that doesn't hold yet.
- **The TypeScript server:** a Bun CPU profile at the same load, so the comparison shows
  where each spends its time, not only how much.

## Acceptance criteria

- [ ] CPU and off-CPU profiles of the native server at a passing load and past capacity,
      kept with the run's raw results
- [ ] Allocation profiles of the hot paths, with the allocations per request listed
- [ ] A Bun profile of the TypeScript server at the same load
- [ ] The bottlenecks found, each with what removing it would take and the gain the
      profile suggests, recorded here
- [ ] Follow-up tasks for the ones worth fixing
