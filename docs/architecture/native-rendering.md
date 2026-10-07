# Native server rendering

Planned for the native backend (task 081); the TypeScript deployment remains on Start.
Kait chose embedded rendering on 2026-10-02. The render crate implements it, and the
native host (`snowtime-axum`) serves the timer and report pages through it.
[Task 081.01](../../tasks/081-native-backend/01-server-rendering.md) records measurements
and remaining work.

Two engines sit behind one interface (`Pool`, `PageRequest`, `Page`), and `RENDER_ENGINE`
picks one at start. Kait decided on 2026-10-06 that the Bun sidecar is the preferred
engine wherever memory isn't the deciding constraint, and that V8 embedded in the host
stays the engine for the smallest memory budgets and the fallback
([task 081.16](../../tasks/081-native-backend/16-javascriptcore.md)). The reason is
render CPU: Bun renders the four measured pages with 34–40% less CPU than V8 (one CPU on
WSL, with recorded API answers), and Bun maintains the engine, its collector, and the web
APIs. The sidecar's end-to-end measurements can still reverse this, for example if
rendering turns out to be a small share of the whole server's CPU. The V8 engine is built; the sidecar is planned. Both follow the lane
contract in [native-host.md](native-host.md).

## V8 in the host

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
memory, and from its CPUs, with at least one renderer. With the memory left after that,
it gives each renderer a 32 or 16 MiB semi-space, so a page fits in V8's young
generation; that costs 20–50 MB per renderer and saves 3–11% of render CPU (task
081.14). On Linux it watches its RSS and, near the limit, has renderers collect after
every page and stops the extra ones. A full queue answers 503, and so does a page still
queued after `max_queue_wait`, however long the render ahead of it takes. A page whose
client leaves is withdrawn from the queue, or stopped if it renders, and the API calls it
started are aborted. A supervisor thread joins the renderer threads and replaces one that
panics. Past the restart budget the pool is down, and pages answer 503 while the API keeps
working ([native-host.md](native-host.md)).

Deno's web extensions supply URL parsing, encoding, and streams. The host collects on
idle time or an old-generation threshold and replaces an isolate when collection fails to
reduce its live heap. A watchdog interrupts synchronous JavaScript; a separate async
deadline covers API futures. A failed render replaces the isolate, and the host answers 500. The render crate documents the current thresholds, which remain tunable.

The prototype-getter props experiment keeps the plain server bundle as the default on
both engines (`RENDER_PROTOTYPE_PROPS=0`). Task 081.19 found faster V8 report pages but a
slower timer, and 20–36% more render CPU on Bun. The explicit flag selects the alternate
V8 snapshot at build time or the Bun bundle at startup. It changes no browser assets or
pool policy. [The WSL report](../../tasks/081-native-backend/server-rendering/prototype-props-wsl.md)
records the measurements and the audited props-enumeration scope.

## Bun sidecar (planned)

The host starts each renderer as a child process running the stock `bun` binary on the
same render bundle, and talks to it over a socket pair with length-prefixed frames that
carry what `op_send`, `op_head`, and `op_chunk` carry today. The decisions below apply the
lane contract; task 081.16 records the shape, the image, upgrades, and licensing.

- **One page in flight per renderer.** Rendering is CPU-bound and Bun runs JavaScript on
  one thread, so a second page in the same process would wait inside Bun, where the host
  can't see or bound it. The pool's queue stays the only queue.
- **Least privilege where it's cheap.** Kait, 2026-10-06: render code is trusted as much as
  the TypeScript server's code, but it's the only npm code in the native server and it
  sees every user's session, so a renderer gets only what rendering needs:
  - an empty environment plus the renderer's settings, so no secrets;
  - a token valid for one render in place of the session cookie, which the host swaps
    back when an API call arrives on the socket, so the renderer never holds a session;
  - a seccomp filter, set before `exec` with `no_new_privileges`, that refuses internet
    sockets and allows Unix ones, so it can't send data out or be used for SSRF;
  - Landlock limiting its files to the bundle directory, where the kernel and container
    allow it, so it can't read `/data` or the TLS keys.

  Rejected: a separate user, mount views, and a full syscall policy. They need root at
  start or image work, risk Bun's JIT, and add little beyond the four rules. Confinement
  doesn't cover build-time supply-chain attacks or tampered HTML; CI and the content
  security policy cover those.

- **The host buffers the page whole,** as with V8, up to a maximum page size, so a slow
  client never holds a renderer. A page past the maximum fails with 500. This is
  Snowtime's choice for finite pages; it gives up streaming's early first byte.
- **Deadlines kill the process.** A render past its deadline gets SIGKILL and a
  replacement; the host needs no watchdog inside the engine.
- **Restart budget.** Crashes and deadline kills past N in T seconds stop the respawning;
  planned recycles don't count. The host then serves pages from V8 if the image includes
  it, or answers 503.
- **Recycling keeps capacity where memory allows.** A renderer whose RSS passes its limit
  stops taking pages. If the memory budget has room for one more renderer, its
  replacement starts and warms first; otherwise the old one exits after its page and the
  pool runs one short while the replacement warms. The host recycles one renderer at a
  time, with jitter, and measures memory as the cgroup's usage plus each child's RSS.
- **Renderers die with the host.** The socket is a `socketpair()` whose end the child
  inherits, so there's no path to clean up. On Linux the host sets `PR_SET_PDEATHSIG` in
  each child before `exec`, and starts each in its own process group, which it kills
  whole so no descendant survives.
- **Renderer count from measurement.** On one core, extra renderers only overlap the time
  a page waits on `op_send` round trips, and each costs a Bun process's RSS. Task 081.16
  sweeps the count.

## Rejected

- Static shells (task 079): their warm load showed content 430–480 ms later than a
  server-rendered page. The shell decision and the spike's earlier recommendation against
  embedding are superseded by Kait's choice above.
- Actix Web, with an isolate per worker: it measured 4.5% less CPU on the timer page
  than Axum's shared render thread (task 081.01), which doesn't outweigh Axum's fit with
  the API router and better-auth-rs, and Axum keeps the renderer count apart from HTTP
  workers.
- JavaScriptCore embedded in the host, including Bun's build: higher RSS under
  collection, an unstable embedding interface in Bun's build, and LGPL source and
  relinking provisions for static distribution. Task 081.16's gate confirmed the memory
  cost on 2026-10-06, and its prototype is paused.
- SpiderMonkey: comparable speed with more memory and slower startup than V8's snapshot.
  QuickJS needs Intl polyfills and is too slow; Boa rendered error pages. Perry did not
  compile the bundle. These are the recorded spike results, not claims about later
  releases.

The spike's rejection of a separate Bun render process (it adds a process and an IPC
lifecycle and keeps the renderer's memory cost) is superseded by the decision above.
After task 081.14's tuning, V8's render CPU is 1.50–1.63 times Bun's on the four
measured pages.

## Memory target

The API-only 64 MB RSS target does not apply unchanged to this design. A replacement
whole-server target still needs agreement, and Docker measurements on the Mac need
confirmation on the Linux deployment host.
