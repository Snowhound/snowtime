# 081.34: Edge connections and lanes

Status: done

Fix H3, M4, M6, M11, L2, and L18 from task 081.30 on branch `081-edge`, from `081-audit`
at `d67ba4c`, and build the M6 design Kait decided on 2026-10-08. No Docker, load, or
stress runs: M6 has no load evidence, so tests and source tests show it.

## Acceptance criteria

- [x] H3: every listener sets hyper's HTTP/1 timer and header timeout and HTTP/2 timer
      and keep-alive pings; the acceptor adds an idle timeout and connection caps, in
      total and per client address. Host tests cover partial headers, idle connections,
      and both caps.
- [x] L2: a request past `EDGE_TIMEOUT_SECONDS` answers 503 with `Retry-After: 1`, with
      the API's JSON body on `/api` paths.
- [x] L18: `CatchPanicLayer` answers a panic with the API's JSON 500 on the API router and
      plain text at the edge, with tests that panic in an async handler.
- [x] M4: rate-limit keys hold a route template or a rule's pattern, not the raw path,
      and the edge answers 414 past a URI limit.
- [x] M6: database owner threads, a startup index of the public files, and a blocking
      pool of a fixed size for files and DNS only.
- [x] M11: a precompressed variant serves only when its base path is in the index.
- [x] Probe results before and after, and the verification counts against the baseline.

## Changes

- **H3.** `edge/connections.rs` sets hyper's HTTP/1 timer, header timeout, and a 64 KiB
  read buffer, and HTTP/2 pings every 20 seconds with a 20-second timeout, on the plain,
  TLS, ACME, and redirect listeners. Its acceptor wraps the TLS acceptor: it counts
  connections per listener in total and per normalized client address, and closes one
  past a cap before its handshake. It ends a connection's stream once no request has
  been in flight for the idle timeout; a request counts from its call until its response
  body is sent or dropped.
- **L2.** An edge middleware replaces `TimeoutLayer`'s 408 with 503 and `Retry-After: 1`.
- **L18.** The API router answers a panic with `{"error":{"message":"Internal error."}}`,
  which covers pages' in-process calls too. The edge answers other panics with
  plain-text 500.
- **M4.** The rate-limit layer runs as a `route_layer` and on the API fallback. A routed
  request counts under its route's template from `MatchedPath`; any other under the rule
  pattern it matched. The edge refuses a path and query longer than
  `EDGE_URI_LIMIT_BYTES` with 414.
- **M6.** `server/src/lane.rs` is one lane type: a gate in front of dedicated threads
  fed by a bounded channel. The writer has one thread; each reader has a thread that
  owns its connection; password hashing uses the same type at lower priority. The
  writer's connection stays behind a mutex, which a reader's session check takes while
  holding the writer's free slot. A job whose caller left before a thread took it
  doesn't run. `Gate` no longer runs work, and nothing in either crate calls
  `spawn_blocking`. Tokio's blocking pool is fixed at four threads, for files and DNS.
- **M6 and M11.** `edge/files.rs` lists the public directory's non-directory entries at
  startup: 301 paths, 13 KB of names, for the current build. Only a request whose decoded
  path is in the list reaches `ServeDir`; any other goes to pages, so `/backup` with only
  `backup.gz` present is a page.

## Settings

| Variable                           | Default                               | Behavior                                                        |
| ---------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| `EDGE_HEADER_TIMEOUT_SECONDS`      | `30`                                  | Headers must arrive in time; on HTTP/1 also the keep-alive wait |
| `EDGE_IDLE_TIMEOUT_SECONDS`        | `60`                                  | Close a connection with no request in flight                    |
| `EDGE_MAX_CONNECTIONS`             | `4096`                                | Open connections per listener; zero disables                    |
| `EDGE_MAX_CONNECTIONS_PER_ADDRESS` | `256`, or `0` with `CLIENT_IP_HEADER` | Open connections per listener and client address; zero disables |
| `EDGE_URI_LIMIT_BYTES`             | `8192`                                | Path and query limit, answered with 414; zero disables          |

The two timeouts take a positive number of seconds. The HTTP/2 ping interval and timeout,
the 64 KiB HTTP/1 buffer, and the four blocking threads are constants.

## Deliberate differences

- HTTP/1 connections close after 30 seconds idle, because hyper's header timeout also runs
  while a kept-alive connection waits; Caddy keeps them for 5 minutes.
- A connection past a cap is closed without an answer. Caddy has no connection cap.
- HTTP/1 request heads above 64 KiB get 431; hyper's default allowed about 400 KiB, and
  Bun behind Caddy allowed 16 KiB.
- Better Auth keeps one rate-limit quota per path. Natively, `/api/auth/callback/{id}`
  shares one quota across providers, and every unported `/api/auth/` path shares its
  rule's quota per address. Unported paths still answer 429 past the limit, so
  `hardening-compare.ts` stays byte-equal. A wrong method on a ported route isn't rate
  limited, because the method fallback runs outside `route_layer`.
- Edge timeouts answer 503 instead of 408. A job admitted to a lane but not yet started
  when its caller leaves, by timeout or disconnect, no longer runs; one already running
  still commits.
- Files added to `EDGE_STATIC_DIR` after startup are pages until a restart. Symbolic
  links to directories aren't followed; `ServeDir` alone followed them.
- With `bench`, `blocking_threads` counts lane threads, password threads included, and
  reader statistics list each reader's last snapshot without an `idle` count.

## Verification

Run 2026-10-08 and 2026-10-09 on macOS arm64 before each commit. `cargo fmt --check`,
both Clippy runs, the `bench` build, and `bunx tsc --noEmit` passed each time.

| Check                   | Baseline `d67ba4c` | H3, L2, L18 | M4       | M6, M11  |
| ----------------------- | ------------------ | ----------- | -------- | -------- |
| Server tests, each mode | 108                | 109         | 109      | 113      |
| Host tests              | 17                 | 23          | 24       | 28       |
| Conformance             | 49 / 528           | 49 / 528    | 49 / 528 | 49 / 528 |
| `compare.ts` byte-equal | 1,381              | 1,381       | 1,381    | 1,381    |
| `hardening-compare.ts`  | 17 checks          | 17          | 17       | 17       |

Conformance counts are tests and assertions across 10 files. The M6 server count drops a
`Gate::run` cancellation test, whose case moved to the lane tests. A host test makes four
FIFO reads hold every blocking thread and checks that a database call still answers within
2 seconds. Against the previous server crate it fails at that deadline.

## Probes

`bun native/bench/audit/probe.ts native/target/debug/snowtime-axum slowloris ratekeys
precompressed orderedjson`, on the `bench` build:

| Probe                                 | Before `d67ba4c`                     | After                                   |
| ------------------------------------- | ------------------------------------ | --------------------------------------- |
| Partial headers                       | Open after 45 s                      | Closed after 30.0 s                     |
| Idle keep-alive after one response    | Open after 45 s                      | Open after 45 s in the probe; see below |
| Unknown 30 KB auth path               | 404                                  | 414                                     |
| RSS after 2,000 unique 30 KB paths    | 52,896 → 118,448 KiB                 | 53,424 → 53,936 KiB                     |
| `/backup` with gzip, only `backup.gz` | 200, the archive's contents          | 200, the rendered page                  |
| `orderedjson`, 100,000 keys           | 200 in 115 ms; concurrent PATCH 5 ms | 200 in 110 ms; concurrent PATCH 3 ms    |

The probe's idle socket never reads, so Node leaves the response unread and doesn't
report the close behind it. A client that reads (Python, or the probe's socket with
`s.resume()`) sees the after host close the connection 30.0 s after the response; the
before binary keeps it open past 50 s.
