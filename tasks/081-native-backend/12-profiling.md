# 081.12: Profiles of both servers under load

Status: in-progress (isolate measurements recorded; server load profiles still pending)

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

### WSL baseline, 2026-10-05

Work runs in Ubuntu 26.04.1 on WSL2, in `/root/snowtime`, on an AMD Ryzen 7
5800X3D (8 cores, 16 threads), kernel `6.18.40.1-microsoft-standard-WSL2`.
Windows uses the **AMD Ryzen Balanced** power plan, not High performance. Docker
Desktop supplies the WSL backend. Tools: Bun 1.4.2, Rust 1.99.0, and clang.
The idle Snowtime app and Caddy containers were stopped for each measurement loop
and restored afterward; Mailpit remained idle.

Each engine renders the same bundle against the same recorded API answers. The
Bun callback copies response bytes, as the Rust callback does. Runs use
`--cpus=1 --memory=2g`, one renderer/client, 50 warm-ups, and 500 measured renders,
three times. These are medians of the three runs, in milliseconds:

| Engine           | Page  |   p50 |   p95 | CPU/render |
| ---------------- | ----- | ----: | ----: | ---------: |
| V8 before        | timer | 16.31 | 35.26 |      19.77 |
| V8 before        | week  | 10.73 | 21.47 |      11.95 |
| V8 before        | month | 12.78 | 34.37 |      15.91 |
| V8 before        | year  | 16.00 | 39.47 |      20.45 |
| Bun              | timer |  8.74 | 20.83 |      10.55 |
| Bun              | week  |  5.78 | 12.83 |       6.92 |
| Bun              | month |  7.25 | 17.24 |       8.59 |
| Bun              | year  |  8.79 | 19.37 |      10.34 |
| Bun JS polyfills | timer | 17.54 | 35.02 |      20.20 |
| Bun JS polyfills | week  | 10.96 | 25.48 |      12.82 |
| Bun JS polyfills | month | 15.64 | 30.19 |      17.89 |
| Bun JS polyfills | year  | 22.08 | 39.76 |      25.21 |

Raw runs:
[`V8 before`](server-rendering/render-web-apis-wsl-before.jsonl),
[`Bun`](server-rendering/render-web-apis-wsl-bun.jsonl), and
[`Bun with JS polyfills`](server-rendering/render-web-apis-wsl-polyfills.jsonl).
The initial Bun draft runs are excluded: their callback reused the captured
response buffer instead of copying it.

The forced-polyfill mode replaces URL, encoding, streams, Headers, Request, and
Response with permissively licensed JS implementations. It also redirects the fetch
polyfill's `node:util` encoding import to the JS text-encoding fallback. This is a
reconstructed reference, not the deleted spike harness. Native and polyfill Bun
renders produce byte-identical HTML for all four pages.

Chrome hydration passes for both Start and V8: timer 610, week 434, month 901, and
year 1,376 keyed nodes, all preserved, without errors, and with navigation in the
same document. These checks establish the baseline; the selection is recorded below.

### Isolate profiles and API candidates

The four V8 inspector profiles start after 50 warm-ups and sample 500 renders.
The first Bun CLI profiles include startup, warm-up, and the measured loop; a bounded
Bun sampling mode was added to obtain a matching window on the same pages and answers. Source-map summaries are in
[the raw profile summary](server-rendering/render-web-apis-wsl-profiles.json);
[profile-run CPU](server-rendering/render-web-apis-wsl-profile-runs.jsonl) records
instrumentation overhead separately. The full profiles and matching bundle/map stay
under ignored `native/crates/render/results/profiles/`.

These percentages describe **main-thread self samples including idle**, not shares
of whole-process CPU. V8's background compiler and collector are outside the inspector
profile. Bun reports substantial unnamed native work; absence of a named GC bucket
does not imply that it performs no collection.

| V8 bucket                |  Timer |   Week |  Month |   Year | Next step                                                |
| ------------------------ | -----: | -----: | -----: | -----: | -------------------------------------------------------- |
| Solid                    | 33.02% | 29.08% | 28.51% | 26.33% | Profile mergeProps/splitProps and allocations            |
| GC                       | 20.80% | 18.16% | 22.55% | 26.27% | Attribute allocation sites before changing collection    |
| App                      | 19.36% | 11.53% | 13.29% | 15.88% | Isolate wallClock and ICU costs                          |
| TanStack                 |  6.06% | 10.20% |  9.16% |  8.70% | Profile router/query setup and serialization             |
| Native ops               |  2.53% |  2.65% |  3.66% |  5.03% | Separate callback, encoding, and JSON costs with perf    |
| Deno streams             |  1.44% |  0.55% |  1.75% |  0.60% | Keep current writer; string writer regressed             |
| Request/Response/Headers |  0.62% |  1.10% |  1.33% |  1.00% | Reduced operations have micro wins, unconfirmed in pages |
| WebIDL                   |  0.39% |  0.94% |  0.44% |  0.55% | Avoid replacements without a whole-page gain             |
| API decoding             |  0.13% |  0.30% |  0.82% |  0.34% | Keep schema decoding                                     |
| URL                      |  0.03% |  0.20% |  0.09% |  0.18% | Too small to explain the engine gap                      |
| Idle                     |  5.88% | 14.70% |  7.26% |  6.65% | Exclude when interpreting CPU attribution                |

The host callback and ICU do not have reliable separate self buckets in V8's inspector
output: their work appears beneath generated/native frames and the app's `wallClock`.
Encoding also has no separately named sampled JS bucket. Zero listed samples is not
evidence of zero cost. Bun's Solid shares are 34.00%, 28.46%, 31.76%, and 31.85%;
its native/unattributed shares are 24.20%, 44.16%, 25.16%, and 25.97%. See the raw
summary for all buckets. These samples suggest where to investigate; they do not
establish a numerical decomposition of the CPU gap.

[API microbenchmark runs](server-rendering/render-web-apis-wsl-microbench.jsonl) and
[medians](server-rendering/render-web-apis-wsl-microbench-summary.json) compare observed
argument sizes against Deno, Deno core, Rust, V8's permissively licensed simdutf,
encoding_rs, Ada, and reduced JS operations. Each case runs three repetitions in one
isolate with a warm-up. The timing loop awaits each operation, including synchronous
ones, so it includes the same promise-loop overhead for those candidates.

Encoder inputs use captured HTML sliced to the traced code-unit sizes; decoder inputs
use captured API bytes. They reproduce sizes and representative content, not every
original argument. URL tests compare `href` resolution, not a full URL class. Query
strings and Headers use representative inputs; the small JS candidates implement only
that operation. Stream and clone tests use representative buffers and date-containing
values. Intl uses numeric timestamps from captured answers, capped at 256 distinct
instants. The microbenchmark `calls_per_page` field is a traced count for encoder cases and a
representative frequency for the other cases; for Intl it names the number of distinct
instants. Do not use that field to estimate total page CPU outside encoder cases.
These limitations prevent selecting full API replacements from this table.

For the timer's 255,953-code-unit encoding case, Deno took 324.10 µs, the Rust op
67.84 µs, and simdutf 41.47 µs. At 127 code units, Deno took 0.56 µs, Rust 0.41 µs,
and simdutf 0.44 µs. Ada href resolution took 0.37–0.50 µs against Deno's
0.79–1.02 µs. A bounded Intl cache returning fresh parts objects took about
0.29–0.31 µs against ICU's 2.74–2.90 µs on these repeated instants. Whole-page
comparisons are required before keeping any of these candidates.

A direct HTML string writer passed byte equality and hydration, but increased median
CPU/render by 20.5% on the timer, 14.0% on the week, 31.5% on the month, and 45.2%
on the year in three alternating comparisons. It was reverted. Raw runs:
[stream control](server-rendering/render-web-apis-wsl-stream-alternating.jsonl) and
[string candidate](server-rendering/render-web-apis-wsl-string-alternating.jsonl).
The stream samples alone would have predicted neither this magnitude nor its direction.

The [detailed call trace](server-rendering/render-web-apis-wsl-call-mix.json) records
formatter options and arguments from an actual post-warm-up page. The timer makes
201 formatToParts calls across 127 distinct numeric instants. Each report makes four
numeric calls at one instant and two calls through its date formatter. The earlier
Intl microbenchmark's 15/43 captured-answer instants therefore model repeated numeric
formatting, not the actual per-page mix. The report workload cannot account for a
large caching gain, and the 256-entry cache does not churn on these captures.

### Selected isolate changes

Keep the bounded numeric `Intl.DateTimeFormat.formatToParts` cache and the UTF-8
encoder op. The cache holds at most 256 instants per formatter in a WeakMap and
returns fresh arrays and parts objects. Non-numeric arguments use ICU directly.
The encoder uses V8's simdutf bindings for larger Latin-1/UTF-16 strings and V8's
UTF-8 conversion for strings up to 256 code units. Invalid UTF-16 falls back to
V8's replacement conversion. Deno still checks receiver branding and handles
non-string conversion. No frontend code changed.

Three alternating original/combined rounds give these medians in milliseconds.
Each run uses 50 warm-ups, 500 renders, one CPU and 2 GiB:

| Page  | Control CPU | Selected CPU | Change | Selected p50 | Selected p95 | CPU above Bun |
| ----- | ----------: | -----------: | -----: | -----------: | -----------: | ------------: |
| timer |       18.99 |        17.96 | -5.42% |        14.93 |        34.20 |         70.2% |
| week  |       11.86 |        11.71 | -1.26% |        10.59 |        21.58 |         69.2% |
| month |       15.68 |        15.78 | +0.63% |        12.47 |        34.97 |         83.6% |
| year  |       19.37 |        18.99 | -1.99% |        15.20 |        37.49 |         83.6% |

Raw runs: [control](server-rendering/render-web-apis-wsl-combined-control.jsonl),
[selected](server-rendering/render-web-apis-wsl-combined-alternating.jsonl), and
[summary](server-rendering/render-web-apis-wsl-selection.json).

Timer CPU improved in all three pairs, by 4.3–5.8%; week by 1.3–2.4%; year by
1.7–2.9%. Month's first batch was noisy: two pairs were 0.7–1.1% slower and one
5.4% faster. Three additional month pairs did not reproduce a consistent regression:
control median 15.58 ms, candidate 15.34 ms, a 1.54% reduction; the individual
changes were -1.42%, -5.29%, and +1.40%.
[Confirmation control](server-rendering/render-web-apis-wsl-month-confirm-control.jsonl)
and [candidate](server-rendering/render-web-apis-wsl-month-confirm-candidate.jsonl)
keep that uncertainty visible. Do not claim a precise month gain.

The separate [Intl control](server-rendering/render-web-apis-wsl-intl-cache-control.jsonl)
and [candidate](server-rendering/render-web-apis-wsl-intl-cache-alternating.jsonl)
showed about 3% timer savings, with mixed smaller report results. The plain Rust
encoder's [control](server-rendering/render-web-apis-wsl-encoding-control.jsonl) and
[candidate](server-rendering/render-web-apis-wsl-encoding-alternating.jsonl) were
also mixed; its timer median changed by +0.09%. The combined SIMD candidate is
retained for its reproducible timer, week, and year CPU savings, with the month
confirmation above. Microbenchmark rankings alone did not select it.

Chrome hydration passes for all four selected pages: 610, 434, 901, and 1,376 keyed
nodes, none replaced, no errors, and same-document navigation. Original and candidate
HTML is byte-identical, including the fixed harness nonce. Render tests cover short
and large ASCII, Latin-1, emoji, malformed UTF-16, BOM/fatal decoding, receiver errors,
conversion side effects, mutable Intl results, eviction, locales, mutable Dates, and
DST boundaries. Render Clippy and all 626 app tests pass.

### What remains

V8 still uses about 70–84% more CPU than native Bun in the primary selected runs.
This pass does not close that gap or prove the fastest full implementation of every
API. Solid, app rendering, allocation/GC, and compiler work remain stronger leads than
URL and request wrappers. Their exact contributions to the difference are unproven.

| API                         | Decision                             | Evidence and limit                                                       |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| Encoding                    | Keep SIMD encoder; keep Deno decoder | Whole-page encoder comparison above; decoder micro wins vary by input    |
| Intl                        | Keep bounded numeric-parts cache     | Real timer call mix and repeated whole-page gain; no browser changes     |
| URL                         | Keep Deno                            | Ada wins href-only microbench; this is not a full URL class comparison   |
| URLSearchParams             | Keep Deno                            | Reduced serializer covers objects only, not iteration/mutation semantics |
| Headers, Request, Response  | Keep Deno                            | Reduced JS/JSON probes lack full class/body consumption semantics        |
| Streams and HTML writer     | Keep Deno and streaming writer       | String writer regressed CPU despite small stream sample share            |
| AbortController             | Keep Deno                            | Observed calls measured; no confirmed whole-page replacement gain        |
| structuredClone, Blob, File | Keep Deno                            | No calls observed on the captured pages; clone probe is representative   |

The matching [bounded Bun profiles](server-rendering/render-web-apis-wsl-bun-bounded-profiles.json)
cover only the measured render loop. Their Solid self-sample shares are 39.52%,
37.95%, 37.52%, and 37.31%; native/unattributed shares are 29.59%, 34.06%, 33.81%,
and 31.25%. Bun's raw stack sampler does not provide a matching named GC breakdown;
these recorded-stack shares are not directly interchangeable with V8's idle-inclusive
wall samples.

[Bounded profiling runs](server-rendering/render-web-apis-wsl-bun-bounded-runs.jsonl)
cost 26.41, 11.93, 16.94, and 46.93 ms CPU/render, including the sampler and profile
result construction. That is about 150%, 72%, 97%, and 354% above the uninstrumented
Bun medians. V8 inspector runs cost 22.21, 14.35, 18.53, and 22.68 ms, about 12%,
20%, 16%, and 11% above its baseline. Profiling overhead is material; none of those
instrumented numbers is used as the performance target.

The timer's [whole-process perf summary](server-rendering/render-web-apis-wsl-timer-perf-summary.json)
and [resolved symbols](server-rendering/render-web-apis-wsl-timer-perf-report.txt)
use 99 Hz software cpu-clock sampling, DWARF unwinding, and V8 JIT dumps injected
with monotonic timestamps. Named GC self symbols account for about 17.94%, named
compiler symbols 2.52%, ICU/Intl 3.24%, and string/encoding symbols 1.93%.
JIT code/builtins account for 26.19%, other V8 runtime 35.29%, and other/unattributed
11.95%. Rounded rows sum to 99.06%; these regex groups are conservative descriptions
of named symbols, not a complete allocation of GC or host-callback cost.

V8 worker threads account for about 20.99% of these CPU samples, the render thread
77.98%, and Tokio workers 0.09%. This confirms that the inspector misses material
background work. Perf records the whole harness, including startup, warm-up, and
idle collection; it is not the inspector's steady-state-only window.
The [instrumented run](server-rendering/render-web-apis-wsl-timer-perf-run.json)
records its measured-loop CPU separately. Raw perf data and the retained 12 MiB JIT
dump remain ignored under results/profiles. No samples were lost. The Docker image
needs binutils as well as linux-perf for symbol resolution.

The larger remaining investigation is [task 081.13](13-render-allocations.md):
allocation sites, GC/compiler work, and rendering helpers. Whole-host load and
off-CPU/allocation profiles remain part of this task and were outside this isolate pass.

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
- [x] Follow-up tasks for the ones worth fixing
