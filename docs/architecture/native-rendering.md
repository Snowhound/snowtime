# Native server rendering

Planned for the native backend (task 081); the TypeScript deployment remains on Start.
Kait chose embedded rendering on 2026-10-02. The render crate implements it, and the
native host (`snowtime-axum`) serves the timer and report pages through it.
[Task 081.01](../../tasks/081-native-backend/01-server-rendering.md) records measurements
and remaining work.

The native backend embeds V8 through `deno_core` and loads the app's Solid server bundle
from a startup snapshot. It uses Start's streaming render, router dehydration, and
serialization adapters. The server bundle must split route components like the client
build, and the host must serve that build's assets and pass its client manifest. Start's
production client hydrates the HTML.

Axum is the HTTP choice. Each renderer is a thread that owns one isolate and a
current-thread Tokio runtime; Axum handlers queue pages for the renderers and never move
an isolate between threads. A renderer writes the whole page into a buffer and takes the
next one, so a slow client never holds it; the handler sends the buffer. The host passes
its API router's `oneshot` as the callback behind `setSend`. API paths, methods, headers,
and bodies use the same contract as browser requests. An isolate finishes one page before
taking the next, keeping locale, cookies, and query state separate.

The host sizes the pool from the memory it may use, the cgroup's limit or physical
memory, and from its CPUs, with at least one renderer. On Linux it watches its RSS and,
near the limit, has renderers collect after every page and stops the extra ones. A full
queue, or a page that waited too long in it, answers 503.

Deno's web extensions supply URL parsing, encoding, and streams. The host collects on
idle time or a used-heap threshold and replaces an isolate when collection fails to
reduce its live heap. A watchdog interrupts synchronous JavaScript; a separate async
deadline covers API futures. A failed render replaces the isolate, and the host answers 500. The render crate documents the current thresholds, which remain tunable.

Rejected:

- Static shells (task 079): their warm load showed content 430–480 ms later than a
  server-rendered page. The shell decision and the spike's earlier recommendation against
  embedding are superseded by Kait's choice above.
- Actix Web, with an isolate per worker: it measured 4.5% less CPU on the timer page
  than Axum's shared render thread (task 081.01), which doesn't outweigh Axum's fit with
  the API router and better-auth-rs, and Axum keeps the renderer count apart from HTTP
  workers.
- A separate Bun render process: it adds another process and an IPC lifecycle while
  keeping the renderer's memory cost. The embedded callback can use the host's API
  directly.
- JavaScriptCore, including Bun's build: similar Linux render time, higher RSS under
  collection, and an unstable embedding interface in Bun's build. Static distribution
  also needs the LGPL source and relinking provisions.
- SpiderMonkey: comparable speed with more memory and slower startup than V8's snapshot.
  QuickJS needs Intl polyfills and is too slow; Boa rendered error pages. Perry did not
  compile the bundle. These are the recorded spike results, not claims about later
  releases.

The API-only 64 MB RSS target does not apply unchanged to this design. A replacement
whole-server target still needs agreement, and Docker measurements on the Mac need
confirmation on the Linux deployment host.
