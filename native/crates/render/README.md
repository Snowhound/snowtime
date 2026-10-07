# Native rendering

`snowtime-render` embeds the app's Solid server bundle in a deno_core startup snapshot.
It renders pages without Start's request runtime, and Start's production client hydrates
them. The host crate (`snowtime-axum`) serves pages through it.

## Host contract

`Pool::start(send, manifest, policy)` starts renderers, each an isolate on a thread of its
own with a current-thread Tokio runtime. The cloneable `Pool` is `Send + Sync`. An Axum
handler awaits `render(PageRequest)` and gets the whole page: status, headers, and body.
The renderer writes the body into a buffer and goes back to the queue, so a slow client
never holds it. The current year fixture, the largest page, is about 379 kB; `max_page_bytes` fails a
page above 8 MiB. One page renders at a time per isolate, so cookies, locale, and query
caches cannot overlap.

`SendApi` is an `Arc` callback returning a `Send` future. It receives method, path
(including the query string), headers, and body bytes, and returns status, headers, and
body bytes. The bundle installs it with `setSend` and adds the page's cookie to each call;
API data reaches the query cache through the same schema decoder as browser requests.
Response bytes move into a V8 `Uint8Array` without a JavaScript array of numbers. The host
passes the API router's `oneshot`.

The host supplies the absolute URL, request headers, cookie, and a fresh CSP nonce. The
bundle reads the locale from the cookie and `Accept-Language`, as Start's paraglide
middleware does, unless the request names one. `now` freezes `Date` for the render; the
host sets it only when `PERF_NOW` moves its clock, so pages and API agree on the day.

The manifest must come from the **same production build** whose assets the host serves.
`bundle/build.ts` reads it from `.output`, strips it as Start's `getStartManifest` does,
and writes it beside the bundle with a copy of `.output/public` (`bundle/dist/public`).
The crate embeds the manifest as `MANIFEST`; the host serves `dist/public`
(`EDGE_STATIC_DIR`). Rebuild the bundle after every app build: a stale manifest names assets
the new build no longer has.

## Queue and renderers

All renderers take pages from one bounded queue. `render` refuses a page as `Busy` when
the queue is full, and a renderer refuses one that waited longer than `max_queue_wait`;
the host answers both with 503 and `Retry-After`. A renderer skips a page whose caller
has gone, such as one whose connection closed.

The pool starts `min_renderers`. While pages wait, it adds one renderer at a time, up to
`max_renderers`; an extra renderer idle for `retire_after` stops. `set_pressure(true)`
makes renderers collect after every page, stops extra ones, and adds none. The host sets
the counts, heap limits, and semi-space size from the memory it may use and reports pressure from its RSS
(`crates/host/src/memory.rs`).

## Web APIs and collection

Deno's MIT extension crates supply URL parsing, text encoding, structured cloning,
Request/Response, and streams. Their stream machinery is JavaScript backed by native
ops, as Deno implements it. The isolate's `fetch` throws; app reads go through the host
callback. The isolated SSR build replaces Solid's `mergeProps` descriptor-map enumeration with
own-key enumeration. It preserves descriptor traps, non-enumerable props, lazy getters,
and inherited descriptor-map keys. The adapter fails the build if the upstream helper
changes. Browser sources and the production client are unchanged. Task 081.13 records
the measured benefit and compatibility tests.

Numeric Intl parts use a bounded per-formatter cache that returns fresh
parts objects; string encoding uses a thin V8/simdutf op. Receiver checks and non-string
conversion remain with Deno. Task 081.12 records the measured selection and its limits.

The default policy collects after one second idle, or after a page that leaves more than
48 MiB in V8's old generation. It replaces the isolate if a collection leaves more than
80 MiB live there. Both thresholds leave out the young generation, which a scavenge
empties, so a larger nursery doesn't force a full collection after every page.
`semi_space_bytes` fixes the size of each of the young generation's two semi-spaces; the
host sets 32 or 16 MiB when its memory allows, and otherwise V8 sizes it from the heap
limit (task 081.14). A near-limit callback terminates work when the old generation
reaches its share of the 128 MiB heap limit and grants 16 MiB for unwinding. A set
semi-space adds three times its size on top, so at 32 MiB the whole heap may reach about
212 MiB; the host counts that in each renderer's memory. These are heap thresholds, not
process RSS limits. After each collection
on glibc, the renderer calls `malloc_trim(0)`: glibc otherwise keeps 55–60 MiB that V8's
compiler and the page buffers freed, which is most of the gap between a warm renderer's
RSS and its V8 heap (task 081.01, "Late growth").

A watchdog interrupts synchronous JavaScript at five seconds, and a Tokio deadline also
covers host futures. A thrown, timed-out, or oversized render fails the page, and the
renderer replaces its isolate. The old isolate is disposed before the replacement is
created; overlapping their lifetimes on one thread violates V8's scope ordering.

## Reproduce

Run from the repository root, with Bun, Rust, Docker, and Chrome installed:

```sh
bun install --frozen-lockfile
caffeinate -i bun run build
bun native/crates/render/bundle/build.ts
caffeinate -i cargo build --release --manifest-path native/Cargo.toml -p snowtime-render --bins
caffeinate -i cargo test --release --manifest-path native/Cargo.toml -p snowtime-render
caffeinate -i bun native/crates/render/bundle/capture.ts
caffeinate -i native/crates/render/bundle/measure.sh pages
caffeinate -i native/crates/render/bundle/measure.sh renderers
caffeinate -i native/crates/render/bundle/measure.sh long
caffeinate -i bun native/crates/render/bundle/hydrate-check.ts
```

On Linux omit `caffeinate -i`. `capture.ts` starts the production app on the
deterministic Lumen Works seed and records all API answers and reference HTML; it never
pre-seeds the renderer's query cache. `measure.sh` runs `render-bench` in Docker with
`--memory=2g` against those answers: `pages` renders each page 500 times, three times, on
one CPU; `renderers` runs 1 to 4 renderers with as many clients on four CPUs; `long`
renders the timer 5,000 times with glibc's default malloc arenas and with two.
`render-bench` reports process CPU with `getrusage`, RSS from `/proc/self/status` every
quarter second, peak RSS with `getrusage`, and glibc's in-use and free heap. The browser
check serves V8 HTML in place of Start's document, checks errors and original DOM nodes,
and navigates to the other page without reloading.

`results/` and the generated bundle are ignored. Raw measurements and findings are kept
in tasks 081.01 and 081.12.

## Render profiling and API benchmarks

The profiling harness covers timer, week, month, and year reports. Run it from the
Linux filesystem in WSL; Docker runs use one CPU and 2 GiB. Stop other busy services
during measurements and restore them afterward.

Install the isolated benchmark dependencies without changing the app's lockfile:

```sh
(cd native/crates/render/bundle/bench && bun install --frozen-lockfile && bun run build)
bun native/crates/render/bundle/build.ts
docker build -f native/crates/render/bundle/bench/Dockerfile -t snowtime-render:api-bench .
```

Set `RENDER_CPU_PROFILE=/results/timer.cpuprofile` on a render-bench container to
record V8's inspector profile after its initial render and 50 warm-ups.
`RENDER_ALLOCATION_PROFILE=/results/timer.heapprofile` instead samples V8 heap
allocations at 128 KiB, including objects collected by minor and major GC.
`RENDER_PROFILE_COUNT` defaults to 500. Use one renderer and client; this instrumentation
does not aggregate multiple isolates. `render-bench` makes an extra unmeasured render
to stop and write the profile. Its `profile_finish_cpu_ms` includes that render,
collection, and output. The loop CPU excludes this finish work. Deep allocation trees
are preserved as raw inspector JSON. `RENDER_API_TRACE=1` also writes a sibling
`.apis.json` file with one page's API call counts and argument sizes. Trace runs add
wrappers and must be separate from timing runs.

`RENDER_PERF_PROF=1` enables V8 JIT names for Linux perf. Record with `perf record -k 1`
and inject the JIT dump with `perf inject --jit` inside the same container before it exits.
Use a known working directory (for example `/tmp`) and save its `jit-*.dump` files;
V8 writes them to the working directory by default.
The benchmark image includes perf; recording requires PERFMON and SYS_PTRACE capabilities
and an unrestricted seccomp profile. Keep these privileges confined to measurement runs.

For Bun's matching harness:

```sh
bun native/crates/render/bundle/bun-bench.ts native/crates/render/results/timer.json native/crates/render/results/answers.json 500
bun native/crates/render/bundle/bun-bench.ts --polyfills native/crates/render/results/timer.json native/crates/render/results/answers.json 500
```

Set `BUN_RENDER_PROFILE=<path>.jsc.json` to sample only the measured loop with
`bun:jsc.profile`, after warm-up. Loop counters stop inside the callback, before result construction.
`profile_outside_loop_cpu_ms` includes setup and result construction;
`profile_serialization_cpu_ms` measures JSON encoding and file output separately.
`BUN_RENDER_BUNDLE` selects an absolute saved bundle path for an original reference.
Bun's `--cpu-prof` flag instead includes startup
and warm-ups; keep those profiles separate. The forced-polyfill mode
uses MIT JS URL, streams, and fetch implementations and an Apache-2.0 text-encoding
fallback. It redirects the fetch package's internal encoding import too.

`bundle/bench/profile-summary.ts <profile> <render.js.map>` attributes self samples
to source files. Save the matching bundle and source map with each profile. Percentages
include idle samples, omit other process threads, and are not whole-process CPU shares.
Measure profiling overhead separately.

`web-api-bench <page> <results-directory>` runs API microbenchmarks inside the isolate.
It needs that page's HTML, request, captured answers, and `profiles/<page>-trace.apis.json`.
The `api-bench` Cargo feature adds MIT/Apache-2.0 Ada and encoding_rs only to this binary.
Microbenchmarks report three repetitions in one isolate. Their reduced URL, Headers,
query-string, and JSON candidates are comparisons of observed operations, not complete
replacement classes; a microbenchmark win alone does not select a production API.

### Allocation and engine comparisons

Save the original image and bundle/map before building a candidate. Use the same captures
and production-client manifest throughout:

```sh
native/crates/render/bundle/compare.sh original-image candidate-image native/crates/render/results/comparison /work/native/crates/render/results/original/render.js
native/crates/render/bundle/profile-pages.sh candidate-image allocation/final
native/crates/render/bundle/profile-perf.sh candidate-image allocation/final
```

The comparison alternates three rounds per page and checks exact HTML. Its optional
fourth argument selects Bun's original bundle inside the mounted `/work` checkout.
Without it, Bun uses the current generated bundle. Profiling scripts use a results
subdirectory as their optional second argument; never overwrite another bundle's profiles.
The perf script samples all inherited threads only during the measured loop, using FIFO
acknowledgements. `cgroup_cpu_ms` includes the perf recorder inside the container;
`cpu_ms` includes only the renderer process and its threads. Both counters bracket the
loop, with a small extra cgroup-counter read outside process CPU timing.

Summarize allocation profiles with `bundle/bench/allocation-summary.ts <profile> <map>`.
Estimated bytes exclude Rust allocations and external buffers. Summarize perf using
`python3 bundle/bench/perf-summary.py <report.txt> <stacks.txt>`; it counts first frames
and reports named GC/compiler symbols conservatively. Unresolved Bun native/JIT samples
remain unresolved. Source maps for the adapted Solid helper retain line attribution,
with columns mapped to the start of each upstream line.

`bundle/heap-policy.sh <candidate-image>` compares 128/256 MiB heap limits and their
proportional collection/replacement thresholds. It is a memory-policy diagnostic,
not a production recommendation: the host supplies its own thresholds. The four-page
allocation investigation, raw timings, profiler overhead, rejected candidates, and
remaining gap are in
[the WSL report](../../../tasks/081-native-backend/server-rendering/render-allocations-wsl.md).

Before committing a render change, run render Cargo tests and Clippy, the browser
hydration check, `bun run test`, harness lint, formatting, and both Knip checks. Keep
large profiles, source maps, perf data, and JIT dumps under ignored `results/`.
