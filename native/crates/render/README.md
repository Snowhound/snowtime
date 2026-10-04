# Native rendering

`snowtime-render` embeds the app's Solid server bundle in a deno_core startup snapshot.
It renders pages without Start's request runtime, and Start's production client hydrates
them. The host crate (`snowtime-axum`) serves pages through it.

## Host contract

`Pool::start(send, manifest, policy)` starts renderers, each an isolate on a thread of its
own with a current-thread Tokio runtime. The cloneable `Pool` is `Send + Sync`. An Axum
handler awaits `render(PageRequest)` and gets the whole page: status, headers, and body.
The renderer writes the body into a buffer and goes back to the queue, so a slow client
never holds it. The year report, the largest page, is 482 KB; `max_page_bytes` fails a
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
the counts and heap limits from the memory it may use and reports pressure from its RSS
(`crates/host/src/memory.rs`).

## Web APIs and collection

Deno's MIT extension crates supply URL parsing, text encoding, structured cloning,
Request/Response, and streams. Their stream machinery is JavaScript backed by native
ops, as Deno implements it. The isolate's `fetch` throws; app reads go through the host
callback.

The default policy collects after one second idle, or after a page that leaves more than
48 MiB of used V8 heap. It replaces the isolate if a collection leaves more than 80 MiB
live. A near-limit callback terminates work at the 128 MiB heap limit and grants 16 MiB
for unwinding. These are heap thresholds, not process RSS limits. After each collection
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
in task 081.01.
