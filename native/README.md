# Native backend

The proof of concept of task 081: the JSON API that the timer and the reports read, in
Rust, on the same SQLite schema as the TypeScript backend, with its own authentication, and
those pages rendered by the app's own server bundle in V8. Subtask 03
(`tasks/081-native-backend/03-port-libraries.md`) records the API's measurements and
subtask 01 (`01-server-rendering.md`) the renderer's.

## Crates

`server` is the library of application rules and their Axum router. `render` embeds V8
and renders pages. `host` reads the configuration and serves both as `snowtime-axum`. The
libraries bind no listening socket.

```text
crates/server/src/
  auth/          app_session, acceptance, cookie, oauth, passkeys, password, session, sign_in, writes, schemas, routes
  availability/  mod, routes
  entries/       mod (rules), schemas, routes
  projects/      mod (rules), schemas, routes
  reports/       mod (rules), aggregation, schemas, routes
  settings/      mod (rules), schemas, routes
  teams/         mod (rules), schemas, routes
  timer/         mod (rules), schemas, routes
  http.rs        InOrganization, AsUser, Public, AuthCall, router
  scope.rs       tenancy
  schemas.rs     shared validation, Empty, and Patch
  queries.rs     shared SQL helpers
  calendar.rs · holidays.rs · fill.rs   src/lib/calendar.ts, holidays/, taglines/fill.ts
  errors.rs · wire.rs · timestamp.rs · clock.rs · rate_limit.rs · timing.rs · config.rs
crates/render/   the renderer pool (crates/render/README.md)
crates/host/src/
  main.rs        listeners, TLS, and the renderers' startup sizing
  pages.rs       the page handler and the renderer's in-process API calls
  memory.rs      renderer count and heap limits from memory; pressure from RSS
  edge/          the API, then public files, then pages; TLS, ACME, middleware, logging
  config.rs
```

Each domain's `routes.rs` mirrors the ported paths in its TypeScript routes file.
Unported routes answer 404. Ported reads: the session, the running timer, entries and
the first entry's start, projects, teams, members, and all five report reads (report,
breakdown, entries, entry totals, and export). Each report read uses `run_report`, so
reports and export pieces take the report budget before database admission.
The sign-in page's reads (sign-in methods, deployment, seeded users), password sign-in,
and Better Auth sign-out are also ported. `/sign-in` renders signed out.
Of the other writes, the timer's, the entries', settings PUT/PATCH, and project writes
(including team assignments) and team writes (including membership and roles) are ported.
Invitation preview/list/create and issue-link writes are also ported, with all 880
functional comparison calls byte-equal in task 081.26.
Invitation acceptance through the application API and Better Auth is ported in
[task 081.28](../tasks/081-native-backend/28-auth-port.md), including team assignment
and acceptance by an existing member without changing their role.
Passkey registration, sign-in, listing, and removal are also ported in task 081.28.
The native verifier uses the spike's pinned WebAuthn core and the existing COSE columns;
challenge state lives in the shared verification table.
Google, GitHub, and Microsoft redirect sign-in, account linking, listing, and removal
are ported in task 081.28. OAuth state is signed, stored in the verification table,
and bound to PKCE; provider HTTP calls run without holding the database.
The audited organization writes and profile update are also ported: active organization,
slug checks, creation and renaming, member roles and removal, invitation cancellation,
and profile names. Leaving an organization shares the removal cleanup. Malformed removal
and leave bodies preserve Better Auth's validation refusals.
Better Auth's direct ID-token sign-in is outside the app-used redirect flows and remains
unported, as do its other endpoints that the client does not call.

[Task 081.26](../tasks/081-native-backend/26-functional-port.md#local-review) gives
localhost commands for separate seeded TypeScript and native hosts.
[Task 081.28](../tasks/081-native-backend/28-auth-port.md#local-review) gives acceptance
review commands and links for a new member and an existing member.

Pages call the API in process: the renderer's host callback sends each call through
`router.oneshot` with the page request's cookie, as `src/lib/api/request.ts` sends it.

## SQL helpers

`queries.rs` holds `sql!`, `Sql`, `Assignments`, and `list`. Only a string literal becomes
SQL text in `sql!`; a fragment carries its parameters along, and other expressions bind
as `?`. The timer, entries, projects, and scope rules use them.

```rust
let users = list(&user_ids);
let query = sql!("select id from time_entry where user_id in ", users);
let ids = query.query(db, |row| row.get::<_, String>(0))?;
```

`Assignments` omits absent patches, binds null for removals, and binds present values.
The writer caches 256 prepared statements. `DB_READ_CONNECTIONS=auto` (the default)
opens one read-only connection per available core, and none on a one-core host, where
all requests use the writer. Set a number from 0 to 256 for an explicit pool size; 0 keeps
all requests on the writer.
The host uses WAL in both modes. Each reader has a 2 MiB page-cache budget and caches
64 prepared statements; these caches fill on demand.

GETs and POST routes marked as reads lease a reader. The renderer's in-process calls
use the same router and pool. Other calls and sign-in writes use the writer. Session
checks can renew expiry or delete expired sessions; these operations take the writer
after the session SELECT has finished, even when the calling rule uses a reader.
Maintenance rechecks the session under the writer lock before changing it. A
request already using the writer reuses that lock.
Readers cannot mutate the database. A lease returns its connection on early errors
and normal completion. The pool remains opt-in: measured benefits depend on the
workload and core allocation. [Subtask 10](../tasks/081-native-backend/10-load-and-scaling.md)
records the paired results, memory costs, and reasons for retaining the default.

DB calls acquire async admission before entering Tokio's blocking pool. Each connection
class has its own gate: reads wait for one of the `DB_READ_CONNECTIONS` readers when the
read pool is on, and everything else waits for the writer's single slot. A reader renews
or deletes a session only when the writer's gate has a free slot, and otherwise leaves it
to a later request.
`SCRYPT_CONCURRENCY` defaults to available cores. `WORK_QUEUE_TIMEOUT_MS` defaults to
1,000 ms. Admission expiry returns 503 with `Retry-After: 1`. The blocking thread limit is
the readers, plus one for the writer, plus the hash concurrency. Sign-in holds no DB
permit while hashing. Renderer reads use the host runtime.

`/livez` answers 200 while the API can serve, and `/readyz` reports each lane
([native-host.md](../docs/architecture/native-host.md), "Health").

Ramp-first whole-server runs and the two-machine repeat protocol are in
[`bench/scaling/README.md`](bench/scaling/README.md).

The optional `bench` Cargo feature adds connection wait/hold, blocking queue and CPU,
and renderer queue timings, plus one-second SQLite cache, live DB/hash blocking
worker counts, blocking concurrency,
scrypt concurrency, and render-pool counters. New diagnostics are compiled out of the
default build. Thread CPU measurements work on Linux; macOS reports zero for those
fields. Build a benchmark image with `--build-arg CARGO_FEATURES=bench`, or set
`NATIVE_FEATURES=bench` when the stress harness builds it.

## Server rendering

The [render crate](crates/render/README.md) embeds V8 and keeps the rerunnable
server-rendering harness. It, and so the host, needs its JavaScript bundle built first:

```sh
bun run build
bun native/crates/render/bundle/build.ts
```

The host renders every path that isn't under `/api/` or a public file. `EDGE_STATIC_DIR`
names the public files to serve, normally `native/crates/render/bundle/dist/public`,
which `build.ts` copies from the same build as the manifest; unset, a proxy serves them.
Pages come back whole from a renderer and are sent from a buffer. When the queue is full,
or a page waited past its limit, the host answers 503 with `Retry-After: 1`.

At startup the host reads the memory it may use (the cgroup's `memory.max`, else physical
memory) and the CPUs, and sizes the pool: at least one renderer, more while memory allows,
and no more than CPUs: 256 MiB for the server with one renderer and 80 MiB for each
further one, within 75% of the limit. Below about 340 MiB a renderer gets a 64 MiB heap
instead of 128.
`RENDERERS` lowers the count. On Linux it checks its RSS each second: above 80% of the
limit, renderers collect after every page and extra ones stop, until it falls below 70%.

## Password hashing

Sign-in uses AWS-LC's `EVP_PBE_scrypt` through `aws-lc-sys`, with Better Auth's
parameters and stored hash format unchanged. Subtask 08 records the hash timings, build
costs, memory lifetime, and fixed-load run. AWS-LC builds from bundled C sources with the
C compiler already needed by SQLite. Cross-compiling also needs that target's C compiler
and linker. The tested macOS ARM64 and Linux ARM64 targets use pregenerated bindings and
the `cc` builder, without CMake, Go, or bindgen.

The optional `scrypt-bench` feature adds RustCrypto and vendored OpenSSL for measurement.
It is excluded from the release Docker image. Run each candidate sequentially:

```sh
cargo build --release --manifest-path native/Cargo.toml -p snowtime-server --example
scrypt-bench --features scrypt-bench
native/target/release/examples/scrypt-bench aws-lc 30
native/target/release/examples/scrypt-bench openssl 30
native/target/release/examples/scrypt-bench rust 30
bun native/bench/scrypt.ts 30

docker build --target scrypt-bench -f native/Dockerfile -t snowtime-scrypt:bench .
docker run --rm --cpuset-cpus=1 snowtime-scrypt:bench aws-lc 30
docker run --rm --cpuset-cpus=1 snowtime-scrypt:bench openssl 30
docker run --rm --cpuset-cpus=1 snowtime-scrypt:bench rust 30
docker run --rm --cpuset-cpus=1 -v "$PWD/native/bench:/bench:ro" oven/bun:1.4.2 bun
/bench/scrypt.ts 30
```

Each command checks every hash against the Better Auth fixture, discards three warmups,
and reports the median of at least 20 measured hashes. On macOS, vendored OpenSSL needs
Perl and make. The optional Docker stage installs those and `linux-perf` for profiling.

## Run it

The native host reads inherited environment variables only. It doesn't load `.env`
files or accept configuration through command-line arguments. Loading a dotenv file,
with inherited variables taking precedence, is a possible future option; it isn't
implemented.

The server reads the TypeScript server's environment variables: `TURSO_DATABASE_URL` (a
`file:` URL of a migrated database), `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `HOST`,
`PORT`, `CLIENT_IP_HEADER`, and `NODE_ENV=development` or `DEMO_MODE=true` for password
sign-in. `PERF_NOW`, in milliseconds, moves its clock as `perf/lib/clock.ts` does, the
renderer's included. `RENDERERS` is described above, and the edge's variables below.

With `MIGRATE_ON_START=true`, the server migrates the database before it listens, from
`MIGRATIONS_DIR` (default `drizzle/` in the working directory), as the TypeScript
server's standalone entry does. It refuses to start if an applied migration was edited
or deleted (`scripts/db-verify.ts`), applies the pending ones in one transaction, and
records them in `__drizzle_migrations` as drizzle-orm does, so either backend can migrate
the database the other runs. The image doesn't include `drizzle/`; mount it.

```sh
cargo build --release --manifest-path native/Cargo.toml --bin snowtime-axum
bun native/bench/conformance.ts native/target/release/snowtime-axum
bun native/bench/compare.ts native/target/release/snowtime-axum
```

`conformance.ts` serves the binary a copy of the benchmark database at `SEED_NOW` and
runs `conformance/timer.conformance.ts` against it (or the test files given after the
binary); the other files' unported calls fail. `compare.ts` sends the same reads to the
TypeScript build and the binary and fails on any answer that differs in status or bytes,
masking only each server's clock, sign-in time, and URL. It also compares malformed
inputs, the order of request checks, and Better Auth's origin and CSRF checks on
sign-in. `lines.ts` counts the code
lines of each ported handler in TypeScript and in the server crate (or a historical rules
crate it's given).
`api-recording.ts` cuts a `perf:stress` recording down to the calls and pages the native
backend serves, for `perf:stress --app=native --recording=<file>`; `native/Dockerfile`
builds the image that run uses, from the repository root once the bundle is built.

## Optional edge

The host wraps the application router with `tower-http` middleware and serves HTTP/1.1
and HTTP/2. The application library still binds no socket. The edge can wrap a rendered
page router as well: it preserves an existing CSP, including the renderer's nonce.
HTTP/3 remains outside this proof of concept. TLS handshakes expire after 10 seconds.

Without certificate configuration, `snowtime-axum` serves plain HTTP. Configure a
certificate pair to serve HTTPS, or use ACME to obtain and renew certificates:

```sh
TLS_CERT_FILE=/certs/fullchain.pem TLS_KEY_FILE=/certs/key.pem PORT=443 \
  BETTER_AUTH_URL=https://snowtime.example snowtime-axum

ACME_DOMAINS=snowtime.example ACME_EMAIL=ops@snowtime.example \
  ACME_CACHE_DIR=/data/acme PORT=443 HTTP_REDIRECT_PORT=80 \
  BETTER_AUTH_URL=https://snowtime.example snowtime-axum
```

Supply the database URL and authentication secret as in "Run it". Certificate files
and ACME are mutually exclusive. ACME uses Let's Encrypt's production service; set
`ACME_STAGING=true` to try a setup against staging, whose certificates browsers don't
trust, without using up production's rate limits. Persist `/data/acme` across
restarts and allow the host user to write it. The host sets this directory to mode
0700 because the cache contains account and certificate private keys.

ACME uses TLS-ALPN-01. DNS must reach this listener on public TCP port 443; a proxy
that terminates TLS prevents the challenge from reaching it. Behind such a proxy,
use plain HTTP on a private connection or provision an origin certificate through
the certificate-file mode. Wildcard certificates are unsupported.

| Variable                        | Default      | Behavior                                                                     |
| ------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | unset        | PEM certificate chain and private key; both required                         |
| `ACME_DOMAINS`                  | unset        | Comma-separated DNS names, including the app URL's hostname                  |
| `ACME_EMAIL`                    | unset        | ACME account contact email                                                   |
| `ACME_CACHE_DIR`                | `/data/acme` | Persistent account and certificate cache                                     |
| `ACME_STAGING`                  | `false`      | Use Let's Encrypt's staging service instead of production                    |
| `HTTP_REDIRECT_PORT`            | unset        | Separate HTTP listener issuing 308 redirects to the configured app origin    |
| `EDGE_COMPRESSION`              | `true`       | Gzip and zstd for compressible responses of at least 1024 bytes              |
| `EDGE_ACCESS_LOG`               | `all`        | JSON access events on stdout: `all`, `sampled`, or `off`                     |
| `EDGE_HEADERS`                  | `true`       | Security headers, CSP fallback, and private no-store fallback                |
| `EDGE_STATIC_DIR`               | unset        | Serve this public build directory, with `.br`, `.zst`, and `.gz` variants    |
| `EDGE_TIMEOUT_SECONDS`          | `30`         | Response-header timeout; zero disables this host layer                       |
| `EDGE_BODY_LIMIT_BYTES`         | `2097152`    | Request-body limit; zero disables this host layer, leaving API limits intact |
| `EDGE_BENCH_LOG`                | unset        | Complete JSON benchmark log for the sampler                                  |

Boolean switches accept `true` or `false`. `BETTER_AUTH_URL` must be an HTTP(S) origin,
with no credentials, path, query, or fragment. The host normalizes its scheme, hostname,
and default port. TLS requires an HTTPS origin. Redirects
use that origin rather than the request's Host header.

Access logs contain the method, path, status, duration, and transferred body bytes.
They omit query strings, cookies, authorization, and request bodies. General server
and ACME events also go to stdout. An event is written once the response body has
been sent or the client has gone away. `sampled` keeps the first 10 events each second
and then one in 100, as Caddy's log `sampling` does; it suits a busy host where
logging cost shows. `EDGE_BENCH_LOG` writes a separate,
complete, buffered file of the requests that carry `X-Bench-Kind`; set
`EDGE_ACCESS_LOG=off` when only that file is needed. The benchmark file has no
rotation and belongs only in the benchmark stack.

Static files get the Caddy cache policy: one year and immutable under `/assets/`,
one week under `/backgrounds/` and `/brand/`, and revalidation elsewhere. Unknown API
paths stay on the API router even if the directory contains a matching file. Dotfiles
and archive or backup probes are refused. Directory indexes are disabled. Any other path
is a page, which keeps its own `Cache-Control`. The release image copies the render
bundle's public files to `/app/public` and sets `EDGE_STATIC_DIR` to it.

When a proxy supplies the client address, set `CLIENT_IP_HEADER` only on a listener
whose network access is restricted to that trusted proxy. The native API accepts one
valid address from that header, rejects chains, and ignores other forwarded headers. Without it, all listener
modes use `axum_server` connect info for the TCP peer. Sessions and rate-limit keys
normalize IPv4-mapped IPv6 to IPv4 and group IPv6 by `/64`, as Better Auth does.
The direct benchmark trusts its isolated generator network for simulated user IPs.

`RATE_LIMIT` defaults to on unless `NODE_ENV=development`. Set `RATE_LIMIT=on` to
exercise limits in development, or `RATE_LIMIT=off` for perf and stress runs. It
controls both per-IP auth limits and API per-user write limits. Startup logs show
whether it is enabled; `/readyz` includes `rate_limit`. Auth limits use in-memory
`governor` GCRA quotas through `tower_governor`, with Better Auth's 429 JSON body,
`Content-Type: application/json`, and `X-Retry-After` (rounded-up seconds until the
next token). Idle keys are pruned every minute. TLS and ACME remain opt-in.

Verify production auth limits and session IPs with
`bun native/bench/hardening-compare.ts native/target/debug/snowtime-axum`. The ordinary
byte comparison runs in development and cannot exercise TypeScript's auth limiter.
Before `bunx tsc --noEmit`, install the isolated benchmark dependencies with
`bun install --frozen-lockfile` in `native/bench/auth-spike` and
`native/crates/render/bundle/bench`, and run `bun run i18n:compile` in the repository
root. The API-key spike deliberately keeps its pinned Better Auth version separate
from the app's version.

For a local edge comparison, first run the normal benchmark once to create its Caddy
certificate, then add `--direct` to `perf:stress --app=native --recording=<file>`.
The direct run copies that certificate and sends k6 traffic straight to the host's TLS
listener. Caddy remains as the sampler's access point but receives no app requests.

## Performance gate for the kit refactor

The quick gate runs on Kait's Ryzen under WSL, after builds finish. It retains the
starting native server and `render-bench` binaries and alternates fresh processes
in one session: baseline, current, baseline, current (A/B/A/B). It never rebuilds
the baseline. Docker confines the gate to CPU 0, one CPU, and 2 GiB with no swap.
The same container also holds the lightweight client and k6; server CPU comes from
the server's own `/proc` counters, excluding generator CPU. This is a regression
check on a shared WSL host, not Hetzner confirmation or whole-host capacity evidence.

[`perf-gate.ts`](bench/perf-gate.ts) reuses `render-bench`, `timings.ts`,
`api-recording.ts`, `native.ts`, and the existing k6 scenario. Each round measures:

- Timer, week, month, and year: 25 measured renders after the existing 50-page warmup
  and idle collection, one renderer, a 128 MiB heap, and a 32 MiB semi-space. Report
  process CPU per render, p50/p95 latency, and lifetime peak RSS in MiB. The quick
  mode skips only the final idle RSS observation; it retains startup/warmup peaks.
- Session, timer, entries, and week report: 1,000 sequential calls each after five
  warmups, on a fresh frozen Lumen seed copy at `SEED_NOW`. `timings.ts` reports
  server CPU per call from `/proc`, plus `session` and `db` Server-Timing medians.
  Sign-in happens before measurement. `/proc` uses clock ticks, so zero CPU needs
  more repeats; rounded zero Server-Timing durations remain valid observations.
- Ten seconds at 30 recorded API-slice actions per second on a fresh M copy. The
  frozen slice combines the recording's return and week-report reads, deduplicated
  in order; it excludes pages, writes, and password hashing. Report server CPU per
  completed request and lifetime app peak RSS. The existing k6 scenario handles
  request batching, cookies, failures, and dropped-action counters over plain HTTP.
- Retained server binary bytes and shared render bundle bytes. Binaries use the same
  release/strip procedure for both versions. Bun's plain-bundle comparison is not
  part of this native refactor gate.

The defaults aim for 1–2 minutes on the Ryzen after the build. The first run must
confirm this estimate; no gate timings have been recorded yet. The script records
elapsed seconds. `--renders`, `--repeats`, and `--rate` change both A and B together.
Increase repeats if CPU falls below clock-tick resolution; do not lower counts just
to make a failing measurement fit the time estimate.

### Prepare once, then keep the baseline

Use a Linux filesystem checkout with Bun 1.4.2, Docker/Compose, and Chrome for the
initial fixture capture. The full baseline's preparation builds both native images
and preserves the M source/users pair and recording. The full baseline itself is
one capacity ramp and two RSS holds, documented in
[081.01](../tasks/081-native-backend/01-server-rendering.md#baseline-before-the-kit-refactor).
That longer baseline runs once at the start of the kit phase, separately from the gate.

Transfer the branch without pushing if needed. On the Mac, create a bundle and copy
it to the Ryzen yourself; in the Ryzen checkout, fetch the copied file:

```sh
# Mac
git bundle create /tmp/081-linux-confirmation.bundle 081-linux-confirmation
# WSL; replace only the copied bundle's location.
git fetch /mnt/c/Users/YOUR_USER/Downloads/081-linux-confirmation.bundle \
  081-linux-confirmation:081-linux-confirmation
git switch 081-linux-confirmation
```

Keep Windows awake while WSL runs. This PowerShell command opens WSL under a sleep
inhibitor and restores the normal policy when that shell exits:

```powershell
Add-Type 'using System.Runtime.InteropServices; public class GateAwake { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags); }'
[GateAwake]::SetThreadExecutionState([uint32]2147483649)
try { wsl.exe } finally { [GateAwake]::SetThreadExecutionState([uint32]2147483648) }
```

Run the following in that WSL shell, at the committed starting revision. Finish all
preparation before measuring. Keep the Ryzen idle and run one measurement at a time.
No LAN generator or remote server is used. Kait runs every command on the Ryzen.

```sh
baseline_date=$(date -u +%F)
baseline_recording=perf/.cache/stress/kit-pages.json
bun native/bench/scaling/kit-baseline.ts --prepare \
  --date="$baseline_date" --recording="$baseline_recording"
bun native/bench/perf-gate.ts --freeze

# Verify identical artifacts until two consecutive comparisons pass.
bun native/bench/perf-gate.ts --calibrate

# Separately, record the full start-of-kit baseline.
bun native/bench/scaling/kit-baseline.ts \
  --date="$baseline_date" --recording="$baseline_recording"
```

`--freeze` refuses to overwrite `perf/.cache/native-gate/baseline/`. It saves the
server, render harness, shared bundle, source metadata, image IDs, and artifact hashes;
`inputs/` holds immutable copies of the render fixtures, API seed, M seed/users, and
recorded API slice with hashes. Keep these folders throughout the refactor. An
interrupted freeze must be repaired before measurement; preserve `excluded.txt`
and the preparation logs before removing incomplete artifacts.

After each refactor step, build and snapshot only current, then run the gate:

```sh
bun native/bench/perf-gate.ts --build-current
# After the build finishes, leave Windows and WSL idle.
bun native/bench/perf-gate.ts
```

`--build-current` builds the app, render bundles, native host, and render harness,
then copies current artifacts. The retained baseline and inputs stay fixed. A run
checks artifact/input hashes and rejects a checkout that changed after current's
capture. Build-dependency, database-schema, or runtime changes that prevent the old
binary from running require a new matched baseline; keep the original evidence.

### Results and regression rule

The gate prints and saves a table of baseline/current means, deltas, observed noise
bands, and flags. Each band is the larger of `abs(A1 - A2)` and its minimum floor:

| Metric                  | Minimum floor, relative to mean(A) |
| ----------------------- | ---------------------------------- |
| CPU                     | 5%                                 |
| p95 latency             | 10%                                |
| p50 latency             | 5%                                 |
| Server-Timing medians   | Larger of 5% and 0.1 ms            |
| RSS                     | Larger of 5% and 4 MiB             |
| Binary and bundle sizes | 5%                                 |

A regression is `mean(B) - mean(A) > band`. Server-Timing's absolute floor matches
`timing.rs`'s one-decimal resolution, so a 0.0 to 0.1 ms change stays within the band.
Lower values are better for every metric.
This two-round band is a quick review rule, not
a statistical confidence interval. Short p95 samples can be noisy; investigate a
flag with a repeat in an idle session before attributing it to the refactor.

`--calibrate` runs A/B/A/B with the retained baseline artifacts in both positions.
It does not replace current artifacts or rebuild anything, so it also works after
updating only the gate's scripts. Each regression resets the consecutive-pass count.
It stops after two consecutive passes, or stops with exit code 2 on invalid generator
evidence or a setup error. Keep the Ryzen awake and idle throughout the sequence.
The calibration folder retains every attempt, its flagged metrics and exit code,
and `calibration.json` with the final streak. A standalone identical check uses
`--identical`. The 2026-10-08 noise-floor amendment is implemented; its two passing
Ryzen calibration runs are pending Kait's execution and returned evidence.

Exit codes are 0 for a passing gate, 1 for a flagged regression, and 2 for invalid
measurements or setup errors. Generator validity takes precedence over every server
comparison: zero dropped actions and API errors, sampled k6 CPU below 70% of the
assigned core, client CPU below 20%, sampled app/client/k6 RSS below 1,536 MiB,
p95 action duration times offered rate below 35 of the 50 allocated VUs, no observed
process swap, and a replay that
finishes within 13 seconds including a one-second setup delay and k6 startup/drain.
The CPU guard excludes startup samples before offered load. The gate saves generator
CPU/RSS samples and k6 summaries, including VU usage; inspect memory/VU headroom
before accepting a result. Host contention or a container OOM makes the run excluded,
not a regression estimate. Preserve the exclusion reason and repeat later.

Each run writes under `perf/.cache/native-gate/runs/<UTC timestamp>/`: raw renderer
JSON/HTML, API timing JSON, k6 summary and generator samples, service output in
`gate.log`, machine/CPU details, runtime image ID, input/artifact manifests, per-round
metrics, `comparison.json`, `table.md`, and elapsed seconds. Return those folders
with the full-baseline output; retain the artifact/input folders on the Ryzen:

```sh
tar -czf /tmp/native-gate-ryzen.tgz -C perf/.cache native-gate kit-baseline
```
