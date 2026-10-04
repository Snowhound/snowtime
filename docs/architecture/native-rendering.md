# Native server rendering

Planned for the native backend (task 081); the TypeScript deployment remains on Start.
Kait chose embedded rendering on 2026-10-02. The render crate and its standalone HTTP
examples implement this choice; integration into the native host follows subtask 06.
[Task 081.01](../../tasks/081-native-backend/01-server-rendering.md) records measurements
and remaining work.

The native backend embeds V8 through `deno_core` and loads the app's Solid server bundle
from a startup snapshot. It uses Start's streaming render, router dehydration, and
serialization adapters. The server bundle must split route components like the client
build, and the host must serve that build's assets and pass its client manifest. Start's
production client hydrates the HTML.

Axum remains the HTTP choice. A dedicated thread owns the isolate and a current-thread
Tokio runtime. Axum handlers exchange requests and streamed responses through bounded
channels; they never move the isolate between threads. The host passes its API router's
`oneshot` as the callback behind `setSend`. API paths, methods, headers, and bodies use the
same contract as browser requests. An isolate completes one stream before taking the
next request, keeping locale, cookies, and query state separate.

Deno's web extensions supply URL parsing, encoding, and streams. The host collects on
idle time or a used-heap threshold and replaces an isolate when collection fails to
reduce its live heap. A watchdog interrupts synchronous JavaScript; a separate async
deadline covers API futures and stream backpressure. A failed render replaces the
isolate. The host returns an error before headers or aborts a response already streaming.
The render crate documents the current thresholds, which remain tunable.

Rejected:

- Static shells (task 079): their warm load showed content 430–480 ms later than a
  server-rendered page. The shell decision and the spike's earlier recommendation against
  embedding are superseded by Kait's choice above.
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
