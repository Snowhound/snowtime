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

### The V8 render isolate

Rendering is likely the native server's largest CPU cost per page, and nothing has
profiled it yet. Subtask 01 found that the JS polyfills for `URL`,
`TextEncoder`/`TextDecoder`, and streams cost 30–45% of render time, and that Bun's lead
came from implementing them natively. The render crate now gets those APIs from Deno's
extensions (`deno_web`, `deno_webidl`, `deno_fetch`, `deno_net`). Its streams are still
JavaScript over native ops, though. No measurement shows how much of the polyfills' cost
this recovered. On Linux the crate's timer and week p50s are 16.3 / 12.4 ms, against Bun's
9.2 / 5.4 ms in the engine spike. The crate's runs also decode the API answers, so the
two numbers don't compare directly.

Profile the renderer inside the host, under the same load, and on its own with
`native/crates/render`'s harness for the timer, week, month, and year pages:

- V8's CPU profiler (`--cpu-prof`, or the inspector's `Profiler` domain through
  `deno_core`), source-mapped to `src/` and `node_modules/`, with `--perf-prof` for the
  whole-process view above.
- Split render CPU into the app's own rendering (Solid, TanStack Router and Query), Deno's
  JS layers (streams, WebIDL conversions, `URL`, encoding), crossings into native ops, the
  host's API callback (`setSend`), decoding the Rust answers into the query cache, `Intl`
  and ICU formatting, and GC.
- Take Bun's CPU profile of the same pages, so each bucket has a target.
- Check for anything else the bundle still runs in JavaScript that Bun or the host could
  do natively: structured cloning, the HTML writer and its chunks, JSON parsing of API
  answers, and `Intl`. Subtask 01's list of polyfilled APIs is the starting point, not
  the complete list.

For each bucket, record its share of render CPU and what the cheapest fix would be: a
native op, writing HTML straight into a Rust buffer instead of through a web stream, a
change to the render bundle so it stops needing the API, or nothing.

**Goal: render CPU close to Bun's** on the same pages (Kait, 2026-10-05). Deno's
extensions were the first choice because they fit `deno_core`, not because they were
measured as the fastest. For each web API the bundle uses, measure the candidates in the
isolate and keep the fastest that passes the render tests:

- Deno's extension, as now;
- a port of Bun's implementation where it is native code that doesn't depend on
  JavaScriptCore, such as its use of `simdutf` for encoding and `ada` for `URL`;
- a crate called through a thin op: `ada-url`, `simdutf`, or `encoding_rs`;
- a smaller JS version that does only what the bundle calls, where crossing into native
  code costs more than the work.

Measure each API in a microbenchmark of the calls the bundle makes, then in whole
renders. Record the gap to Bun that is left, and why, if it can't be closed.

## Acceptance criteria

- [ ] CPU and off-CPU profiles of the native server at a passing load and past capacity,
      kept with the run's raw results
- [ ] Allocation profiles of the hot paths, with the allocations per request listed
- [ ] A Bun profile of the TypeScript server at the same load
- [ ] A V8 profile of the render isolate, render CPU split into the buckets above and
      compared with Bun's on the same pages, with the native APIs still worth adding
- [ ] The fastest implementation of each web API the bundle uses, chosen by measurement,
      and the remaining render CPU gap to Bun recorded with its causes
- [ ] The bottlenecks found, each with what removing it would take and the gain the
      profile suggests, recorded here
- [ ] Follow-up tasks for the ones worth fixing
