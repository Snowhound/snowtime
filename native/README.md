# Native backend

The proof of concept of task 081: the JSON API that the timer and the reports read, in
Rust, on the same SQLite schema as the TypeScript backend, with its own authentication, and
those pages rendered by the app's own server bundle in V8. Subtask 03
(`tasks/081-native-backend/03-port-libraries.md`) records the API's measurements and
subtask 01 (`01-server-rendering.md`) the renderer's.

Feature level: matches snowtime main c8ffa84. The branch's TypeScript app (`src/`) is
identical to that commit, and against it the native host passes all 55 conformance
tests (542 assertions, 12 files) and all 1,409 `compare.ts` calls byte for byte.
[Task 081.30](../tasks/081-native-backend/30-audit.md#parity-record) records the audit's findings.
[Task 081.31](../tasks/081-native-backend/31-input-bounds.md) records the current checks
and deliberate auth input bounds that differ from TypeScript.
[Task 081.32](../tasks/081-native-backend/32-domains.md) records the login-domain
middleware and Better Auth's error page, and their differences from TypeScript.

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
`router.oneshot` with the page request's cookie and client address, which the host
attaches, not page JavaScript. A page may only read: GET under `/api/v1`, or POST to the
report calls. The host drops every header the page sets but `Content-Type` and `Accept`,
so a call carries neither the page's `Origin` and `Host` nor a client-address header.

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

GETs and POST routes marked as reads run on a reader. The renderer's in-process calls
use the same router and readers. Other calls and sign-in writes use the writer. Session
checks can renew expiry or delete expired sessions; these operations take the writer
after the session SELECT has finished, even when the calling rule uses a reader.
Maintenance rechecks the session under the writer lock before changing it. A
request already using the writer reuses that lock.
Readers cannot mutate the database. The pool remains opt-in: measured benefits depend on the
workload and core allocation. [Subtask 10](../tasks/081-native-backend/10-load-and-scaling.md)
records the paired results, memory costs, and reasons for retaining the default.

DB calls acquire async admission, then run on a database owner thread: one writer
thread, and one thread per reader that owns its connection, each fed by a bounded
channel. Each connection class has its own gate: reads wait for one of the
`DB_READ_CONNECTIONS` readers when the read pool is on, and everything else waits for
the writer's single slot. A job whose caller left before a thread took it doesn't run. A reader renews
or deletes a session only when the writer's gate has a free slot, and otherwise leaves it
to a later request.
`SCRYPT_CONCURRENCY` defaults to available cores. `WORK_QUEUE_TIMEOUT_MS` defaults to
1,000 ms. Admission expiry returns 503 with `Retry-After: 1`. Tokio's blocking pool has a
fixed four threads and serves only public files and DNS lookups; source tests in both
crates refuse `spawn_blocking` and `block_in_place`. Sign-in holds no DB permit while
hashing. Renderer reads use the host runtime.

`/livez` answers 200 while the API can serve, and `/readyz` reports each lane
([native-host.md](../docs/architecture/native-host.md), "Health").

Ramp-first whole-server runs and the two-machine repeat protocol are in
[`bench/scaling/README.md`](bench/scaling/README.md).

The optional `bench` Cargo feature adds connection wait/hold, blocking queue and CPU,
and renderer queue timings, plus one-second SQLite cache, live database and password
lane thread counts, lane concurrency,
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
sign-in. It refuses to start where `src/env.ts` refuses: a `BETTER_AUTH_SECRET` shorter than
32 characters, `MICROSOFT_TENANT_ID` without a Microsoft client, a `CLIENT_IP_HEADER` with
anything but lowercase letters, digits, and dashes, or a `NODE_ENV` or `DEMO_MODE` outside
their values. As in Better Auth, which reads `NODE_ENV` at run time, only
`NODE_ENV=production` selects production behavior such as its OAuth error redirects. In `bench` and
debug builds, `PERF_NOW`, in milliseconds since the epoch, moves the clock as
`perf/lib/clock.ts` does, the renderer's included, and the host logs a warning with the
moment it moved to. Other builds refuse to start with `PERF_NOW` set. `RENDERERS` is
described above, and the edge's variables below.

With `MIGRATE_ON_START=true`, the server migrates the database before it listens, from
`MIGRATIONS_DIR` (default `drizzle/` in the working directory), as the TypeScript
server's standalone entry does. It refuses to start if an applied migration was edited
or deleted (`scripts/db-verify.ts`), applies the pending ones in one transaction, and
records them in `__drizzle_migrations` as drizzle-orm does, so either backend can migrate
the database the other runs. The image doesn't include `drizzle/`; mount it.

```sh
cargo build --release --manifest-path native/Cargo.toml --bin snowtime-axum --features bench
bun native/bench/conformance.ts native/target/release/snowtime-axum
bun native/bench/compare.ts native/target/release/snowtime-axum
```

Both need the `bench` build: the OAuth calls reach the fake provider through
`OAUTH_FAKE_PROVIDER`, which only `bench` builds read.

`conformance.ts` serves the binary a copy of the benchmark database at `SEED_NOW` and
runs `conformance/timer.conformance.ts` against it (or the test files given after the
binary); the other files' unported calls fail. `compare.ts` sends the same reads to the
TypeScript build and the binary and fails on any answer that differs in status or bytes,
masking only each server's clock, sign-in time, and URL. It also compares malformed
inputs, the order of request checks, and Better Auth's origin and CSRF checks on
sign-in. `page-compare.ts` renders the same pages on two hosts, a control and a candidate,
and fails on any byte that differs, masking only the CSP nonce, the hosts' clocks, and the
content hashes in script and style file names, so the control may come from another
frontend build:

```sh
bun native/bench/page-compare.ts <control binary> native/target/debug/snowtime-axum
```

CI (`.github/workflows/native.yml`) runs it on a pull request that leaves `src/` alone,
against the base commit's host. `lines.ts` counts the code
lines of each ported handler in TypeScript and in the server crate (or a historical rules
crate it's given).
`api-recording.ts` cuts a `perf:stress` recording down to the calls and pages the native
backend serves, for `perf:stress --app=native --recording=<file>`; `native/Dockerfile`
builds the image that run uses, from the repository root once the bundle is built.

## Supply chain

`rust-toolchain.toml` pins the toolchain, and `[workspace.lints]` requires a `SAFETY:`
comment on every `unsafe` block. CI also runs `cargo deny check` (with and without
`--all-features`) and `cargo audit`; `deny.toml` ignores no vulnerability.

The release image pins its base images by digest and builds against a V8 library that
`v8-archive.sh` downloads and checks against a pinned SHA-256, rather than the v8 build
script's unchecked download. A new v8 version needs its hashes added there first.

`THIRD_PARTY_LICENSES` holds the notices for the Linux release graph, and the image
copies it to `/usr/share/doc/snowtime/`. Regenerate it after any change to `Cargo.lock`,
with cargo-about 0.9 installed; CI fails while it's stale:

```sh
cargo fetch --manifest-path native/Cargo.toml
native/licenses/generate.sh
```

[`licenses/README.md`](licenses/README.md) says where the bundled V8 notices come from.

## Optional edge

The host wraps the application router with `tower-http` middleware and serves HTTP/1.1
and HTTP/2. The application library still binds no socket. The edge can wrap a rendered
page router as well: it preserves an existing CSP, including the renderer's nonce.
HTTP/3 remains outside this proof of concept. TLS handshakes expire after 10 seconds.

Every listener, the redirect listener included, bounds its connections. A request's
headers must arrive within `EDGE_HEADER_TIMEOUT_SECONDS`; on HTTP/1, hyper runs the same
timer while a kept-alive connection waits for its next request. hyper 1.x has no separate
idle timer: it starts the header timer as soon as a connection is ready for its next
request. A connection with no
request in flight for `EDGE_IDLE_TIMEOUT_SECONDS` closes, which covers HTTP/2 and a
connection that never sends a byte. HTTP/2 connections are pinged every 20 seconds and
closed when a ping goes unanswered for 20 seconds. An HTTP/1 request head and read buffer
take at most 64 KiB; a larger head gets 431. Past `EDGE_MAX_CONNECTIONS` in all, or
`EDGE_MAX_CONNECTIONS_PER_ADDRESS` from one client address, the acceptor closes a new
connection without an answer, before its TLS handshake. Both caps count per listener;
keep the total below the process's file-descriptor limit. The per-address cap groups
IPv6 addresses by /64, as rate limits do. Behind a proxy every connection comes from the
proxy, so with `CLIENT_IP_HEADER` set and no `CLIENT_IP_TRUSTED_PROXIES` the per-address
cap defaults to off.

Behind a CDN, list its address ranges in `CLIENT_IP_TRUSTED_PROXIES`, so the host keeps
the CDN's idle connections longer than the CDN does. Cloudflare reuses an idle origin
connection for up to 900 seconds
([connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/)),
and answers 520 now and then when the origin closes one first. A connection from a listed
proxy closes after `EDGE_PROXY_IDLE_TIMEOUT_SECONDS` (default 920) with no request in
flight, and doesn't count toward the per-address cap. Because hyper applies one header
timeout to every connection, it gets the longer of `EDGE_HEADER_TIMEOUT_SECONDS` and the
proxy timeout. A connection from any other peer keeps the per-address cap and closes after
the shorter of `EDGE_HEADER_TIMEOUT_SECONDS` and `EDGE_IDLE_TIMEOUT_SECONDS` with nothing in
flight, which bounds a partial request head as hyper's timer would. A firewall that admits
only the CDN, or Cloudflare's Authenticated Origin Pulls, is still worth adding: a listed
range is shared by every CDN customer.

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
restarts and allow the host user to write it. Give `ACME_CACHE_DIR` a directory of its
own: the cache holds account and certificate private keys, so the host sets the directory
to mode 0700 at startup, and each cache file (`cached_*`) to 0600, including files already
there.

ACME uses TLS-ALPN-01. DNS must reach this listener on public TCP port 443; a proxy
that terminates TLS prevents the challenge from reaching it. Behind such a proxy,
use plain HTTP on a private connection or provision an origin certificate through
the certificate-file mode. Wildcard certificates are unsupported.

| Variable                           | Default                                                     | Behavior                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `TLS_CERT_FILE`, `TLS_KEY_FILE`    | unset                                                       | PEM certificate chain and private key; both required                                                            |
| `ACME_DOMAINS`                     | unset                                                       | Comma-separated DNS names, including the app URL's hostname                                                     |
| `ACME_EMAIL`                       | unset                                                       | ACME account contact email                                                                                      |
| `ACME_CACHE_DIR`                   | `/data/acme`                                                | Persistent account and certificate cache, in a directory of its own                                             |
| `ACME_STAGING`                     | `false`                                                     | Use Let's Encrypt's staging service instead of production                                                       |
| `HTTP_REDIRECT_PORT`               | unset                                                       | Separate HTTP listener issuing 308 redirects to the configured app origin                                       |
| `EDGE_COMPRESSION`                 | `true`                                                      | Gzip and zstd for compressible responses of at least 1024 bytes                                                 |
| `EDGE_ACCESS_LOG`                  | `all`                                                       | JSON access events on stdout: `all`, `sampled`, or `off`                                                        |
| `EDGE_HEADERS`                     | `true`                                                      | Security headers, CSP fallback, and private no-store fallback                                                   |
| `EDGE_STATIC_DIR`                  | unset                                                       | Serve this public build directory, with `.br`, `.zst`, and `.gz` variants                                       |
| `EDGE_TIMEOUT_SECONDS`             | `30`                                                        | Response-header timeout, answered with 503 and `Retry-After: 1`; zero disables this host layer                  |
| `EDGE_HEADER_TIMEOUT_SECONDS`      | `30`                                                        | Time to receive a request's headers, and on HTTP/1 to wait for the next request; with listed proxies, see above |
| `EDGE_IDLE_TIMEOUT_SECONDS`        | `60`                                                        | Close a connection with no request in flight for this long; with listed proxies, see above                      |
| `EDGE_PROXY_IDLE_TIMEOUT_SECONDS`  | `920`                                                       | Idle timeout for connections from `CLIENT_IP_TRUSTED_PROXIES`                                                   |
| `EDGE_MAX_CONNECTIONS`             | `4096`                                                      | Open connections per listener, TLS handshakes included; zero disables                                           |
| `EDGE_MAX_CONNECTIONS_PER_ADDRESS` | `256`, or `0` with `CLIENT_IP_HEADER` and no listed proxies | Open connections per listener from one client address, listed proxies exempt; zero disables                     |
| `EDGE_BODY_LIMIT_BYTES`            | `2097152`                                                   | Request-body limit, answered with 413; zero disables this host layer, leaving API limits intact                 |
| `EDGE_URI_LIMIT_BYTES`             | `8192`                                                      | Path and query limit, answered with 414; zero disables                                                          |
| `EDGE_BENCH_LOG`                   | unset                                                       | Complete JSON benchmark log for the sampler                                                                     |
| `CLIENT_IP_HEADER`                 | unset                                                       | Lowercase name of the header holding the client address, set by a trusted proxy                                 |
| `CLIENT_IP_TRUSTED_PROXIES`        | unset                                                       | Comma-separated CIDRs whose `CLIENT_IP_HEADER` is read; unset trusts every peer                                 |

Boolean switches accept `true` or `false`. The three connection timeouts take a positive
number of seconds. A request past `EDGE_TIMEOUT_SECONDS` gets 503 rather than 408, which
browsers may resend on their own while the first attempt's write still commits; on `/api`
paths the body is the API's JSON refusal, as it is for a 413 past `EDGE_BODY_LIMIT_BYTES`.
A panic in a handler answers 500: the API's
JSON on its routes and in-process calls, plain text elsewhere. `BETTER_AUTH_URL` must be an HTTP(S) origin,
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

At startup the host lists the paths in `EDGE_STATIC_DIR` once. A request for a path
outside that list goes to pages without a file call, and a precompressed variant
serves only beside its base file, as Caddy requires. Files added after startup aren't
served until a restart. Symbolic links to files are listed; links to directories
aren't followed. The files themselves are read from disk when served.

Static files get the Caddy cache policy: one year and immutable under `/assets/`,
one week under `/backgrounds/` and `/brand/`, and revalidation elsewhere. Unknown API
paths stay on the API router even if the directory contains a matching file. Dotfiles
and archive or backup probes are refused. Directory indexes are disabled. Any other path
is a page, which keeps its own `Cache-Control`. The release image copies the render
bundle's public files to `/app/public` and sets `EDGE_STATIC_DIR` to it. The expected
setup puts a CDN or caching proxy in front, as Snowtime's Cloudflare does; the host
serves static files as the fallback for cache misses
([native-host.md](../docs/architecture/native-host.md), "Tokio at the edge, lanes behind it").

When a proxy supplies the client address, set `CLIENT_IP_HEADER` to the header it
overwrites, and `CLIENT_IP_TRUSTED_PROXIES` to the proxy's address ranges, for example
Cloudflare's published IPv4 and IPv6 ranges. The host then reads the header only from a peer
in those ranges and uses the TCP peer's own address for any other, so a client that
reaches the origin directly can't choose its address. Without `CLIENT_IP_TRUSTED_PROXIES`,
every peer is trusted, so restrict the listener's network access to the proxy. The native
API accepts one valid address from that header, rejects chains, and ignores other
forwarded headers. Without `CLIENT_IP_HEADER`, all listener modes use `axum_server`
connect info for the TCP peer. Sessions and rate-limit keys
normalize IPv4-mapped IPv6 to IPv4 and group IPv6 by `/64`, as Better Auth does.
The direct benchmark trusts its isolated generator network for simulated user IPs.

`RATE_LIMIT` defaults to on unless `NODE_ENV=development`. Set `RATE_LIMIT=on` to
exercise limits in development, or `RATE_LIMIT=off` for perf and stress runs. It
controls both per-IP auth limits and API per-user write limits. Startup logs show
whether it is enabled. Auth limits use in-memory
`governor` GCRA quotas through `tower_governor`, with Better Auth's 429 JSON body,
`Content-Type: application/json`, and `X-Retry-After` (rounded-up seconds until the
next token). A request to a ported route counts under the route's template, so
`/api/auth/callback/{id}` is one quota for every provider. Any other path counts under
the rule pattern it matched, so all unported `/api/auth/` paths share one quota per
address, where Better Auth keeps one per path. Idle keys are pruned every minute. TLS and
ACME remain opt-in.

Verify production auth limits and session IPs with
`bun native/bench/hardening-compare.ts native/target/debug/snowtime-axum`. The ordinary
byte comparison runs in development and cannot exercise TypeScript's auth limiter.
Before `bunx tsc --noEmit`, install the render benchmark's isolated dependencies with
`bun install --frozen-lockfile` in `native/crates/render/bundle/bench`, and run
`bun run i18n:compile` in the repository root.

For a local edge comparison, first run the normal benchmark once to create its Caddy
certificate, then add `--direct` to `perf:stress --app=native --recording=<file>`.
The direct run copies that certificate and sends k6 traffic straight to the host's TLS
listener. Caddy remains as the sampler's access point but receives no app requests.
