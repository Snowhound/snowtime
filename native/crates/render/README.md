# Native rendering

`snowtime-render` embeds the app's Solid server bundle in a deno_core startup snapshot.
It renders the timer and week report without Start's request runtime. Start's production
client hydrates the result. The current native HTTP hosts remain unchanged; subtask 06
must merge before the chosen host wires this crate in.

## Host contract

`RenderThread::start(send, policy)` creates one isolate on a dedicated thread with a
current-thread Tokio runtime. Its cloneable handle is `Send + Sync`. An Axum handler
awaits `render(PageRequest)`, gets status and headers, and streams the `body` receiver.
The job queue holds eight requests and the body channel four chunks by default. A job
owns the isolate through the end of its stream, so cookies, locale, and query caches
cannot overlap. Dropping the body receiver cancels the stream.

`SendApi` is an `Arc` callback returning a `Send` future. It receives method, path
(including the query string), headers, and body bytes. It returns status, headers, and
body bytes. The bundle installs it with `setSend`; API data reaches the query cache
through the same schema decoder as browser requests. Response bytes move into a V8
`Uint8Array` without constructing a JavaScript array of numbers.

The host supplies the absolute URL, request headers, cookie, locale, a fresh CSP nonce,
and the client manifest from the **same production build** whose assets it serves.
`now` is only for reproducible measurements; leave it absent in the host.
`examples/render-host.rs` demonstrates an Axum handler, `Router::oneshot` as the API
callback, and an Actix worker owning a `Renderer` directly. These examples use recorded
API answers, not the unfinished native report rules.

## Web APIs and collection

Deno's MIT extension crates supply URL parsing, text encoding, structured cloning,
Request/Response, and streams. Their stream machinery is JavaScript backed by native
ops, as Deno implements it; this does not claim that every stream operation is native.
The isolate's `fetch` throws. App reads go through the supplied host callback.

The default policy collects after one second idle, or after a completed render when
used V8 heap exceeds 48 MiB. It replaces the isolate if a collection leaves more than
80 MiB live. A near-limit callback terminates work at the 128 MiB heap limit and grants
16 MiB for unwinding. These are heap thresholds, not process RSS limits.

A watchdog interrupts synchronous JavaScript at five seconds. A Tokio deadline also
covers host futures and stalled body consumers. Failure before headers reaches the
caller as `Err`; after headers it errors the body stream. If that consumer stays blocked,
the error send expires after 100 ms and the stream closes. The host should return 500
before headers or abort an already-started response. Every thrown, timed-out, or
cancelled render replaces the isolate. The old isolate is disposed before creating the
replacement; overlapping their lifetimes on one thread violates V8's scope ordering.

## Reproduce

Run from the repository root, with Bun, Rust, Docker, and Chrome installed:

```sh
bun install --frozen-lockfile
caffeinate -i bun run build
bun native/crates/render/bundle/build.ts
caffeinate -i cargo build --release --manifest-path native/Cargo.toml -p snowtime-render --bins --examples
caffeinate -i cargo test --release --manifest-path native/Cargo.toml -p snowtime-render --lib
caffeinate -i bun native/crates/render/bundle/capture.ts
caffeinate -i native/crates/render/bundle/measure.sh
caffeinate -i bun native/crates/render/bundle/hydrate-check.ts
```

On Linux omit `caffeinate -i`. The Docker runs use `--cpus=1 --memory=2g`. Each mode
renders 50 warmups and 500 measured requests, three times, then waits for idle collection.
`render-bench` reports process CPU with `getrusage`, RSS with `/proc/self/status`, and
peak RSS with `getrusage`. `framework-bench.py` measures both HTTP hosts in one container,
using `/proc/<pid>/stat` for server CPU and `/proc/<pid>/status` for memory. Its client
runs in the same one-CPU container, but its CPU is excluded from the server measurement.

`results/` and the generated bundle are ignored. `capture.ts` starts the production app
on the deterministic Lumen Works seed, reads the client manifest, and records all API
answers and reference HTML. It never pre-seeds the renderer's query cache. The browser
check serves V8 HTML in place of Start's document, checks errors and original DOM nodes,
and navigates to the other page without reloading. Raw measurements and findings are
kept in task 081.01.

For live native forwarding, build `snowtime-axum` and run:

```sh
caffeinate -i cargo build --release --manifest-path native/Cargo.toml -p snowtime-axum --bin snowtime-axum
caffeinate -i bun native/crates/render/bundle/live.ts
```

The proxy forwards timer, entries, first-start, and project reads to that unchanged
native server. Session, teams, members, and the report still use recorded responses.
To inspect the measured HTML with its assets, run
`bun native/crates/render/bundle/preview.ts` and open its printed URL.
