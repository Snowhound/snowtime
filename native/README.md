# Native backend

The proof of concept of task 081: the JSON API that the timer and the reports read, in
Rust, on the same SQLite schema as the TypeScript backend, with its own email sign-in, and
those pages rendered by the app's own server bundle in V8. Subtask 03
(`tasks/081-native-backend/03-port-libraries.md`) records the API's measurements and
subtask 01 (`01-server-rendering.md`) the renderer's.

## Crates

`server` is the library of application rules and their Axum router. `render` embeds V8
and renders pages. `host` reads the configuration and serves both as `snowtime-axum`. The
libraries bind no listening socket.

```text
crates/server/src/
  auth/          app_session, cookie, password, session, sign_in, schemas, routes
  availability/  mod, routes
  entries/       mod (rules), schemas, routes
  projects/      mod (rules), schemas, routes
  reports/       mod (rules), aggregation, schemas, routes
  settings/      mod (rules), schemas
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

Each domain's `routes.rs` mirrors the ported paths in its TypeScript routes file. Unported
routes answer 404. Ported reads: the session, the running timer, entries and the first
entry's start, projects, teams, members, and the report (`getReport`). Of the writes, the
timer's and the entries'. Not ported: the report's breakdown, entry lists, and export;
settings, team, project, and organization writes; invitations; and the sign-in page's
reads (sign-in methods, deployment, seeded users), so `/sign-in` signed out answers 500.

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
The connection caches 256 prepared statements instead of rusqlite's default 16, so patch
combinations and user-list lengths have room alongside the fixed queries. The cache stays
bounded; more than 256 distinct statements can still evict older ones.

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
cargo build --release --manifest-path native/Cargo.toml -p snowtime-server --example scrypt-bench --features scrypt-bench
native/target/release/examples/scrypt-bench aws-lc 30
native/target/release/examples/scrypt-bench openssl 30
native/target/release/examples/scrypt-bench rust 30
bun native/bench/scrypt.ts 30

docker build --target scrypt-bench -f native/Dockerfile -t snowtime-scrypt:bench .
docker run --rm --cpuset-cpus=1 snowtime-scrypt:bench aws-lc 30
docker run --rm --cpuset-cpus=1 snowtime-scrypt:bench openssl 30
docker run --rm --cpuset-cpus=1 snowtime-scrypt:bench rust 30
docker run --rm --cpuset-cpus=1 -v "$PWD/native/bench:/bench:ro" oven/bun:1.4.2 bun /bench/scrypt.ts 30
```

Each command checks every hash against the Better Auth fixture, discards three warmups,
and reports the median of at least 20 measured hashes. On macOS, vendored OpenSSL needs
Perl and make. The optional Docker stage installs those and `linux-perf` for profiling.

## Run it

The server reads the TypeScript server's environment variables: `TURSO_DATABASE_URL` (a
`file:` URL of a migrated database), `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `HOST`,
`PORT`, `CLIENT_IP_HEADER`, and `NODE_ENV=development` or `DEMO_MODE=true` for password
sign-in. `PERF_NOW`, in milliseconds, moves its clock as `perf/lib/clock.ts` does, the
renderer's included. `RENDERERS` is described above, and the edge's variables below.

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
lines of each ported handler in TypeScript and in the server crate (or a historical rules crate it's given).
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
  ACME_CACHE_DIR=/data/acme ACME_PRODUCTION=true PORT=443 HTTP_REDIRECT_PORT=80 \
  BETTER_AUTH_URL=https://snowtime.example snowtime-axum
```

Supply the database URL and authentication secret as in "Run it". Certificate files
and ACME are mutually exclusive. ACME defaults to Let's Encrypt's staging service;
set `ACME_PRODUCTION=true` for trusted certificates. Persist `/data/acme` across
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
| `ACME_PRODUCTION`               | `false`      | Use production instead of staging                                            |
| `HTTP_REDIRECT_PORT`            | unset        | Separate HTTP listener issuing 308 redirects to the configured app origin    |
| `EDGE_COMPRESSION`              | `true`       | Gzip and zstd for compressible responses of at least 1024 bytes              |
| `EDGE_ACCESS_LOG`               | `true`       | JSON access events on stdout, after the response body drains                 |
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
and ACME events also go to stdout. `EDGE_BENCH_LOG` writes a separate buffered file;
disable `EDGE_ACCESS_LOG` when only that file is needed. The benchmark file has no
rotation and belongs only in the benchmark stack.

Static files get the Caddy cache policy: one year and immutable under `/assets/`,
one week under `/backgrounds/` and `/brand/`, and revalidation elsewhere. Unknown API
paths stay on the API router even if the directory contains a matching file. Dotfiles
and archive or backup probes are refused. Directory indexes are disabled. Any other path
is a page, which keeps its own `Cache-Control`. The release image copies the render
bundle's public files to `/app/public` and sets `EDGE_STATIC_DIR` to it.

When a proxy supplies the client address, set `CLIENT_IP_HEADER` only on a listener
whose network access is restricted to that trusted proxy. The native API reads that
header as configured; the host does not authenticate arbitrary forwarded headers.
The direct benchmark trusts its isolated generator network for simulated user IPs.

For a local edge comparison, first run the normal benchmark once to create its Caddy
certificate, then add `--direct` to `perf:stress --app=native --recording=<file>`.
The direct run copies that certificate and sends k6 traffic straight to the host's TLS
listener. Caddy remains as the sampler's access point but receives no app requests.
