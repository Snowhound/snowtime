# 081.07: Caddy's essentials in process

Status: todo

In subtask 03's load runs, Caddy spent 0.26–0.35 ms of CPU per request. The native app
spent about 0.4 ms. With Caddy on the same core, Caddy limited the native server: at
100,000 users of the slice it took 43% of the core and reached its 512 MB memory limit.
This subtask tunes Caddy first, then tries doing what Caddy does inside the Rust binary.

## Part 1: tune Caddy, for both apps

The bench Caddy is in `deploy/compose/`. Measure each change with
`bun run perf:stress --run=kinds` and a short ramp. Check the following:

- the access log: off, sampled, or buffered, and what it costs per request;
- TLS session resumption, and whether the bench even uses TLS the way production does;
- `encode` (compression): its CPU per request at the API's response sizes;
- HTTP/1.1 against HTTP/2 between k6 and Caddy;
- why Caddy reached 512 MB: buffering, logs, or connection count.

Record what helps, and change the production and self-hosting Caddyfiles where it's safe.
The TypeScript app keeps Caddy in front of it in every case. Bun does TLS and compression
in native code but on the event loop's thread, so moving them into the app would take CPU
from the rules and the render. Caddy uses other cores.

## Part 2: the essentials in the Rust binary

These are what Caddy does for the app today:

- TLS with **rustls**;
- automatic certificates with **rustls-acme** (or `instant-acme`);
- compression, access logs, timeouts, and body limits with **tower-http** layers;
- redirecting HTTP to HTTPS, and the security headers (`src/server/csp.server.ts` sets the
  CSP), each a few lines;
- static files with tower-http's `ServeDir`, with the cache headers Caddy sends now.

TLS is optional in the binary. With TLS configured, the binary serves HTTPS itself. Without
it, the binary serves plain HTTP behind any proxy: Cloudflare, or a self-hoster's own Caddy
or nginx. Behind Cloudflare, Cloudflare handles TLS to the client and compression, so the
binary needs neither.

Measure the binary without Caddy against the binary behind Caddy, on the same
`perf:stress` run with the same CPU limit. Compare CPU per request, capacity, p95, and
RSS.

**Stretch, later:** HTTP/3 with `quinn` and `h3`. It's less mature than Caddy's, so don't
try it until the rest is measured (Kait, 2026-10-04).

## Acceptance criteria

- [ ] Caddy's tuning measured, and the safe changes applied to the Caddyfiles
- [ ] The Rust host serving TLS with automatic certificates, compression, access logs,
      static files, and security headers, each switchable by configuration
- [ ] Measured with and without Caddy in front, and recorded here
- [ ] Task 081's README updated: "Out of scope" and "Targets" both say Caddy stays in
      front, which this subtask may change
