# 081.07: Caddy's essentials in process

Status: in-progress

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

- [x] Caddy's tuning measured, and the safe changes applied to the Caddyfiles
- [ ] The Rust host serving TLS with automatic certificates, compression, access logs,
      static files, and security headers, each switchable by configuration
- [ ] Measured with and without Caddy in front, and recorded here
- [ ] Task 081's README updated: "Out of scope" and "Targets" both say Caddy stays in
      front, which this subtask may change

## Part 1 measurements (2026-10-04)

### Repeat of the fixed load

An isolated worktree of `081-native-poc` repeats subtask 08's exact M database,
users, and slice recording. The database cache key changed with the checkout, so the
copied database and users file use the current key without regenerating their bytes.
The app and sampler use core 1, Caddy core 0, and k6 cores 2–9. No other load test runs alongside these measurements. The initial baseline is idle;
a later TypeScript fixed pair overlaps another session's Rust compilation and is
excluded from the tuning decision, then repeated on an idle machine.

```sh
caffeinate -i bun run perf:stress --app=native --dataset=M --run=fixed \
  --users=80000 --seconds=120 --recording=perf/.cache/stress/slice.json \
  --caddy-cpuset=0 --label=081-edge-baseline --no-build
```

| Variant            |   Req/s | App CPU | Caddy CPU | Caddy ms/req | Caddy RSS MB | Caddy peak cgroup MB | Return p95 ms |
| ------------------ | ------: | ------: | --------: | -----------: | -----------: | -------------------: | ------------: |
| Baseline           | 1,052.0 |   32.4% |     31.6% |         0.30 |           71 |                  157 |            34 |
| Only the bench log | 1,053.1 |   34.2% |     29.9% |         0.29 |           74 |                  164 |            40 |

Both runs hold the latency targets with no counted errors or dropped iterations.
The baseline's Caddy RSS is below subtask 03's 91 MB. Its cgroup includes 110 MB
of file cache at the last sample, separate from RSS. The earlier 361–397 MB RSS
and 38–42% CPU in subtask 08 do not recur. Subtask 08's idle control already
reproduced subtask 03 after concurrent linting and tests stopped; this repeat supports
that explanation. The residual CPU difference from 26.9% to 31.6% remains within the
range to investigate with paired variants, rather than proving a configuration regression.

Caddy's effective JSON assigns both `bench` and `log0` to the benchmark host. Every
request goes to the sampler's file **and** production stdout. Removing stdout saves
about 0.01 ms per request in this pair, without a measurable RSS improvement.

The baseline does not exercise compression. The recording has no `Accept-Encoding`,
and [k6 2.3.0's transport](https://github.com/grafana/k6/blob/v2.3.0/internal/js/runner.go#L166-L205)
disables automatic compression. Its TLS configuration also has no client session cache,
so new connections do full handshakes. It negotiates HTTP/2 and reuses connections.
These are TLS requests to Caddy's local certificate, rather than plaintext requests,
but they do not model browser or Cloudflare session resumption.

Raw results are in `/private/tmp/snowtime-081-edge/perf/.cache/stress/runs/`:
`2026-10-04T16-52-10-M-fixed-081-edge-baseline` and
`2026-10-04T16-55-12-M-fixed-081-edge-single-log`.

### Fixed-load diagnostics

Each row below serves the same 80,000-user slice for 60 seconds, with Caddy on core 0.
The full bench log stays enabled except in the logging-off diagnostic.

| Variant                                  | Caddy CPU | Caddy ms/req | RSS MB | Peak cgroup MB | Return p95 ms | Received MB |
| ---------------------------------------- | --------: | -----------: | -----: | -------------: | ------------: | ----------: |
| Sample stdout: first 10/s, then 1 in 100 |     28.4% |         0.27 |     69 |            125 |            39 |         366 |
| HTTP/1.1, both logs                      |     26.5% |         0.26 |     68 |            124 |            32 |         400 |
| Explicit gzip, both logs                 |     32.2% |         0.31 |     72 |            142 |            37 |          56 |
| Gzip accepted, `encode` removed          |     30.6% |         0.30 |     68 |            129 |            32 |         366 |

Gzip saves about 85% of received bytes for roughly 1.6 percentage points of Caddy CPU
in the paired control. Keep compression. Keep HTTP/2 and HTTP/3 in production too:
HTTP/1.1's saving here concerns k6's per-virtual-user transports, rather than proving a
benefit for browsers or Cloudflare's multiplexed origin traffic.

The first `081-edge-no-log` attempt is excluded: Caddy's hostname-to-logger mapping
has precedence over `skip_hosts`, so it still wrote both logs. The corrected variant
removes that mapping as well. Caddy 2.11.4's built-in file writer has no buffer-size or
flush-interval option. Adding a third-party buffered writer would change the deployed
binary, so the measurements use the existing writer and sampling instead.

### Per-action comparison

`--run=kinds --users=2 --seconds=30` runs each recorded action alone, 60–61 times.
Caddy has core 0. Costs include connection startup and sampler polling; at 6–8 requests
per second they are larger than the costs at fixed load. Sampling the first 10 logs
per second cannot save much below that rate.

Caddy CPU milliseconds per request:

| Backend and variant    | Return | Timer | Edit | Sign-in |
| ---------------------- | -----: | ----: | ---: | ------: |
| Native, baseline       |   1.45 |  1.22 | 0.74 |    0.72 |
| Native, sampled stdout |   1.74 |  1.43 | 0.84 |    0.70 |
| Native, explicit gzip  |   1.71 |  1.23 | 0.76 |    0.70 |

All six per-action runs hold their targets. The small differences at this rate do
not establish a logging or compression improvement. Fixed-load runs and shared-core
ramps decide whether a change helps at load.

With both access logs disabled, Caddy uses 22.1% CPU (0.22 ms/request), peaks at
66 MB RSS and 95 MB cgroup memory, and keeps 54 MB of file cache. The client still
serves 1,054 requests/s without counted errors. This is a diagnostic, because no
access-log samples remain to validate server latency windows. Compared with a full-log
one-minute run, logging adds about 0.08 ms/request and 28 MB of file cache, with little
RSS difference.

Turning off connection reuse causes a full TLS handshake for each request. Caddy uses
73.9% CPU (0.71 ms/request), versus about 30% with reused connections. Return p95 is
40 ms and Caddy RSS peaks at 62 MB. Fresh handshakes cost CPU but do not reproduce the
large RSS spike. Session resumption is enabled on the server, but k6's stock transport
does not use it; the resumed-connection check below is separate from the load run.

### TypeScript fixed load

At 40,000 users for 60 seconds, Caddy on core 0 and TypeScript on core 1:

| Idle-machine variant          | Req/s | App CPU | Caddy CPU | Caddy ms/req | Caddy RSS MB | Return p95 ms |
| ----------------------------- | ----: | ------: | --------: | -----------: | -----------: | ------------: |
| Both full logs                | 525.1 |   66.8% |     17.2% |         0.33 |           74 |           122 |
| Sample stdout, full bench log | 525.0 |   63.1% |     16.3% |         0.32 |           85 |           137 |

Both hold all targets with no counted errors. The sampled run has fewer sign-ins
(0.75/s against 1.17/s), so its app CPU reduction cannot be credited to logging.
Caddy's saving is small and there is no latency improvement. The preceding pair
(`17-23-09` and `17-24-33`) overlaps Rust compilation in the render-host worktree;
that pair is retained as raw data but excluded from the tuning decision.

### Shared-core ramps and the memory limit

These ramps put Caddy, the app, and sampler on core 1, warm up for 30 seconds,
use 30-second steps, and hold the last passing step for 60 seconds.

| Native variant                | Passing hold | First failed step | Caddy CPU at hold | Caddy RSS at hold MB | Return p95 at hold ms |
| ----------------------------- | -----------: | ----------------: | ----------------: | -------------------: | --------------------: |
| Both full logs                |      100,000 |           125,000 |             36.7% |                  322 |                   186 |
| Sample stdout, full bench log |      100,000 |           125,000 |             33.1% |                  206 |                   100 |

Both holds have no counted errors or dropped iterations. These short ramps establish
100,000 users of the API slice in this pair, not a capacity for the complete app.
Sampling does not change the passing step. Sign-in rates differ between the holds,
so the latency difference cannot be assigned to logging alone.

At the baseline's failed 125,000-user step, Caddy reaches 355 MB RSS and 530 MB
cgroup memory, close to its 512 MiB (537 MB decimal) limit. At the peak cgroup sample,
anonymous memory is 316 MB and file cache 113 MB. Return p95 rises above 2 seconds.
The sampled failed step peaks at 221 MB RSS and 413 MB cgroup memory, with 114 MB
of file cache. Reducing stdout logging does not remove the bench log's cache.

The overload snapshots show growing connection and request state: 613 open file
descriptors, 1,321 goroutines, and 115 requests in flight during the sampled failed
step. After the baseline failed step, the goroutine profile includes 143 HTTP/2
connection readers, and Go reports 301 MB heap reserved against 26 MB still allocated.
The resident spike follows queued requests and additional connections under overload;
heap reservation persists after those requests drain. It is not a TLS-session cache
or compression buffer spike: the uncompressed, reused-connection baseline reproduces
it, while fresh handshakes at a passing load do not.

The earlier subtask 08 runs combine this queueing behavior with competing host work.
Idle controls reproduce subtask 03, and the repeat here returns Caddy to 71 MB RSS.
The shared-core ramp independently reproduces the large RSS and near-limit cgroup
memory when the service falls behind. File cache adds to the cgroup limit but is not
process RSS.

The TypeScript baseline fails its 40,000-user step and holds 30,000. With sampled
stdout, the 40,000-user step passes but its hold fails; it also holds 30,000. Return
p95 in the passing holds is 26 ms / 23 ms, and Caddy CPU is 14.0% / 15.0%. This pair
establishes no capacity gain. At the sampled 50,000-user failed step, Caddy reaches
378 MB RSS and 449 MB cgroup memory while using 21.4% CPU. The app stalls and Caddy
holds more pending traffic, reproducing the memory pattern with the other backend.

The saved native heap profile attributes 30.7% of sampled live heap to HTTP/2 DATA
frame buffers and 19.2% to HPACK header-table entries. This snapshot is after the
absolute peak, so those percentages describe the sampled live heap, not peak RSS.
They support the connection-state diagnosis. Profiles and counter snapshots are kept
in this worktree's `perf/.cache/stress/edge/` alongside the variant JSON.

### Applied changes and checks

- Both production Caddyfiles sample access logs: first 10 per second for each severity
  and message, then one in 100. Removing the block restores full logs. This trades
  complete access history for a modest CPU saving; database audit records are unchanged.
- The benchmark's `bench` logger is selected only for `X-Bench-Kind` requests, with
  `no_hostname` and `log_name`, so requests no longer also go to production stdout.
  Its file log remains complete for server latency windows. Earlier measurements above
  deliberately retain the original duplicate logging to isolate its cost.
- Keep compression, HTTP/2, HTTP/3, and TLS session resumption. An OpenSSL TLS 1.2
  reconnect check reports one new session followed by five resumed sessions.
- The local harness reserves the shared stack across worktrees, checks for older
  benchmark processes, supports explicit encodings and connection reuse, and saves
  cgroup samples. Disabling logs reports client latency but cannot judge server windows.
- Both updated Caddyfiles pass `caddy validate` with Caddy 2.11.4. The reservation test,
  oxlint, and formatting checks pass.

Part 1 is recorded before part 2 starts. The chosen tuning lowers log overhead but
neither removes overload queueing nor establishes a capacity increase. The TypeScript
app keeps Caddy in front.
