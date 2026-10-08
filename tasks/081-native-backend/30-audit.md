# 081.30: Audit the native backend before the repository split

Status: done

Audit the whole native host (`native/`) before it becomes its own repository. Step-by-step
reviews of 081.01–081.29 looked at one change at a time; this audit looks at the whole for
what they missed. Work on `081-audit`, from `081-native-poc` at `a20713f`. Record findings
only; don't fix them, except typos. No Docker, load, or stress runs. Don't push or merge
without Kait's approval.

## Acceptance criteria

- [x] One independent read-only reviewer per area: route table, auth, input handling, SQL,
      edge and configuration, render host, concurrency and denial of service, dependencies
- [x] Each finding checked against the code and its TypeScript counterpart, and reproduced
      with a test or request where feasible; findings that don't hold up dropped
- [x] Findings ranked by severity, each with file:line, the failure, evidence, and a fix
- [x] What each area checked and found sound, so the audit's coverage is visible
- [x] `cargo audit` and `cargo deny check` run; `native/deny.toml` added
- [x] `git diff main -- src` is empty against `main` at `c8ffa84`
- [x] `native/README.md` records the feature level, with the conformance and comparison
      counts from one full verification run

## Summary

The port matches TypeScript's API surface and tenancy: all 41 `/api/v1` routes have the
same authentication, scope, and role checks, and no query reads or writes across
organizations. No SQL injection path exists. The reviewers found no request-reachable
panic that 081.29's sweep missed.

The serious findings are about whole-system behavior that per-step reviews couldn't see:

1. **High:** one admin request with a large JSON body holds the single writer for tens of
   seconds, refusing every other write.
2. **High:** the native migrator deletes child rows in the table-rebuild pattern that
   `docs/migrations.md` prescribes; drizzle's migrator keeps them.
3. **High:** the edge has no header-read timeout, idle timeout, or connection cap, so an
   internet-facing native edge holds slow and idle connections forever.

Eleven medium findings follow, led by the login-domain policy not applying to existing
sessions and by page JavaScript that can abort the whole process. All three high and the
reproducible medium findings were reproduced; the evidence column says which.

## Findings

Severity reflects the native edge facing the internet (TLS or ACME mode), as
[07](07-edge-in-process.md) intends; behind Caddy some edge findings drop a level.
_Reproduced_ means a request or test in [audit/repro](audit/repro/) shows the failure;
_code_ means the code and its dependency sources show it, without a run.

### High

**H1. A large body to an organization write stalls every write.**

Fixed in 081.31 ([input bounds](31-input-bounds.md)).

- **Where:** `native/crates/server/src/auth/ordered_json.rs:73`, called on the whole
  request body by organization create and update (`auth/writes.rs:439`, `:512`), inside
  `write_gate.run`.
- **Failure:** `OrderedJson` deduplicates keys with a linear search, so an object with _n_
  keys costs O(_n_²) string compares. Any user can create an organization and become its
  admin. A 1 MiB body with 100,000 keys under an unknown field runs past the 30-second
  edge timeout while holding the writer's only slot. A settings write sent meanwhile
  gets 503 after the 1-second admission deadline. The edge's 408 drops only the future,
  so the blocking parse keeps the writer. A 2 MiB body costs about four times as much.
  TypeScript's `JSON.parse` is linear.
- **Evidence:** reproduced (`probe.ts orderedjson`): 10,000 keys 425 ms, 25,000 keys
  2,372 ms, 50,000 keys 9,957 ms, 100,000 keys 408 at 30,005 ms; concurrent
  `PATCH /settings` 503 with `Retry-After: 1`.
- **Fix:** index keys in a `HashMap` (or use `indexmap`), keeping first position and last
  value. Parse only the `metadata` subtree, before taking the writer. Cap metadata size;
  Snowtime never sets it.

**H2. Native migrations run with foreign keys on and delete child rows on a table rebuild.**

- **Where:** `native/crates/host/src/main.rs:51` opens the migration connection, and
  `native/crates/server/src/migrations.rs:67` applies all pending migrations in one
  `BEGIN IMMEDIATE`. The bundled SQLite enables foreign keys by default.
- **Failure:** `docs/migrations.md` prescribes rebuilding a table with
  `PRAGMA foreign_keys=OFF` around it. Inside a transaction that pragma is a no-op, so
  `DROP TABLE` on a parent runs an implicit delete and cascades. drizzle-orm's libsql
  migrator turns foreign keys off around the batch, so the same migration keeps the rows.
  No migration in `drizzle/` rebuilds a table yet; the first one silently deletes data
  on hosts that migrate natively.
- **Evidence:** reproduced (`probe.ts migrations`) with a migration that rebuilds `team`:
  native leaves `team_member` 27 → 0 and `project_team` 26 → 0; drizzle's migrator keeps
  27 and 26.
- **Fix:** set `foreign_keys=OFF` on the migration connection before the transaction, run
  `PRAGMA foreign_key_check` before commit and fail on any row, then turn it back on. Add
  this reproduction as a migration test.

**H3. No header-read timeout, idle timeout, or connection cap at the edge.**

- **Where:** `native/crates/host/src/edge/mod.rs:146` (plain and TLS) and
  `native/crates/host/src/main.rs:127` (HTTP redirect). axum-server builds hyper's
  connection builder without a timer, and hyper 1.11.1 drops its default 30-second
  header-read timeout when no timer is set. Nothing caps connections.
- **Failure:** a client that sends part of its headers, or goes idle after one response,
  holds a connection, its task, and its read buffer indefinitely. Enough of them exhaust
  file descriptors; accept then fails for everyone. `EDGE_TIMEOUT_SECONDS` starts only once
  headers are parsed, and the 10-second TLS timeout ends with the handshake. Caddy
  protected the TypeScript deployment from this.
- **Evidence:** reproduced (`probe.ts slowloris`): partial headers and an idle keep-alive
  connection both still open after 45 s.
- **Fix:** configure `http_builder()` on both servers: HTTP/1 `timer` and
  `header_read_timeout`, HTTP/2 `timer` and keep-alive. Add an idle timeout and a
  connection cap (total and per address) in the acceptor. Related: API bodies up to 2 MiB
  are read before the session is checked (`server/src/http.rs:256`); with connections
  capped, consider a smaller limit for routes that don't need it.

### Medium

**M1. `ALLOWED_LOGIN_DOMAINS` doesn't apply to existing sessions or password sign-in.**

- **Where:** `native/crates/server/src/auth/session.rs:88` (`find_session_using`), used by
  `App::user` (`server/src/http.rs:163`) for every `/api/v1` route and by the app session.
  Password sign-in (`auth/sign_in.rs`) creates sessions without the domain check that
  passkeys and OAuth apply.
- **Failure:** a user whose domain leaves the list keeps full API access and renews the
  session each day. TypeScript returns `null` from `getSession` for a blocked domain
  (`src/server/auth/better-auth.server.ts:100-102`), so the API answers 401;
  `docs/architecture/auth.md` requires checking existing sessions. Password sign-in is
  development-only, which limits the second part.
- **Evidence:** reproduced (`probe.ts domains`): with the list narrowed to
  `allowed.example`, an existing session gets 200 on `GET /api/v1/timer` and a full
  `GET /api/v1/session`; password sign-in returns 200.
- **Fix:** return the user's email from `find_session_using` and refuse the session when
  the list is set and the domain is outside it; share one domain check across the six
  places that copy it. Keep sign-out exempt. Add conformance for both cases.

**M2. Page JavaScript can abort the whole host.**

- **Where:** `native/crates/render/src/lib.rs:197` (near-heap-limit callback) and
  `native/crates/render/src/extensions.rs:14-15` (`deno_net`, `deno_fetch`).
- **Failure:** one allocation larger than the heap's headroom ends in V8's fatal
  out-of-memory, which aborts the process rather than failing the page. The network
  extensions register about 45 ops (`op_net_connect_tcp`, `op_dns_resolve`, `op_fetch`,
  TLS, Unix sockets); with no permissions in `OpState`, calling one panics inside a
  function that can't unwind, which also aborts. Either takes the API down with the
  pages, outside the restart budget. Only bundle code reaches these, so this is a
  robustness and supply-chain risk, not a remote one; in-process API responses are also
  buffered without a cap (`host/src/pages.rs`).
- **Evidence:** reproduced with temporary renderer tests
  ([render-tests.rs.txt](audit/repro/render-tests.rs.txt), [render.log](audit/repro/render.log)):
  gradual growth terminates cleanly, but `new Array(3e7)` at a 64 MiB heap ends in
  "Fatal JavaScript out of memory" (SIGTRAP), a 128 MiB string in "invalid size error",
  and `op_net_connect_tcp` in SIGABRT.
- **Fix:** drop `deno_net` and `deno_fetch` (the bundle uses only Request, Response,
  Headers, and streams), or disable their ops. Cap each in-process response and the total
  per page. Give the heap callback one fixed headroom large enough for V8 to fail the
  allocation inside the isolate, and test both paths.

**M3. The edge's rustls has a published advisory and can't be updated.**

- **Where:** `native/Cargo.lock` resolves `rustls 0.23.40`, shared by the edge
  (`axum-server`, `rustls-acme`) and `deno_tls`, which pins `rustls = "=0.23.40"`.
- **Failure:** RUSTSEC-2026-0285 (TLS 1.3 handshake messages accepted across encryption
  levels, CVSS 5.3) is fixed in 0.23.45, but the render crate's `deno_tls` blocks the
  update. The same render dependencies bring `hickory-proto 0.25.2` with
  RUSTSEC-2026-0118 and RUSTSEC-2026-0119; nothing calls its resolver while the network
  ops stay unused (M2).
- **Evidence:** `cargo audit` and `cargo deny check` fail on these three
  ([cargo-audit.log](audit/cargo-audit.log), [cargo-deny.log](audit/cargo-deny.log));
  `cargo update -p rustls --dry-run` leaves 0.23.40 with 0.23.45 available.
- **Fix:** removing `deno_net` and `deno_fetch` (M2) frees rustls; then update it. Run
  `cargo deny` in CI.

**M4. Rate-limit keys hold any request path.**

- **Where:** `native/crates/server/src/rate_limit/layer.rs:23-31`; the layer covers
  unknown `/api/auth/*` paths too, and keys are pruned every 60 seconds.
- **Failure:** each distinct path creates a governor entry holding the path, up to the
  URI limit. Memory grows with the attacker's upload rate until the next sweep. Routing
  variants can't bypass a limit; this is memory only.
- **Evidence:** reproduced (`probe.ts ratekeys`): 2,000 unique 30 KB paths, each 404, raise
  RSS from 52 to 116 MiB; 2,000 requests to one path change nothing.
- **Fix:** key on the matched rule or route template, skip unmatched paths, and cap the URI
  length at the edge.

**M5. Unauthenticated callers fill the verification table, and nothing sweeps it.**

Fixed in 081.31 ([input bounds](31-input-bounds.md)): size bound and cleanup on lookup.

- **Where:** `native/crates/server/src/auth/passkeys.rs:240` and
  `native/crates/server/src/auth/oauth.rs:349-374`; rows are deleted only when consumed.
- **Failure:** each `generate-authenticate-options` call adds a row, and social sign-in
  stores the caller's `additionalData` whole. Better Auth deletes expired rows on every
  lookup (`better-auth/dist/db/internal-adapter.mjs:753`); native never does, so the table
  and its index grow without bound on the single writer.
- **Evidence:** reproduced (`probe.ts verification`): 50 calls add 50 rows; one
  unauthenticated sign-in with 1.5 MB `additionalData` stores a 1,500,249-byte row; an
  hour later all 51 expired rows remain.
- **Fix:** delete expired rows on lookup as Better Auth does, or on a timer. Cap
  `additionalData` (for example 4 KiB).

**M6. Static files and DNS share the database's blocking threads.**

- **Where:** `native/crates/host/src/main.rs:26` caps Tokio's blocking pool at
  `readers + 1`; `ServeDir` (`host/src/edge/mod.rs:31`) uses `tokio::fs`, which runs on that
  pool, as does reqwest's resolver. `docs/architecture/native-host.md` says only database
  admission reaches it, and the source test checks only the server crate.
- **Failure:** every page request probes up to four files, and static reads run there in
  chunks. On one core the pool has one thread, shared by the writer and every file probe.
  A flood of asset or page requests queues admitted database jobs behind file work, so
  their wait is no longer bounded by the deadline, and a caller that left still runs.
- **Evidence:** code (tower-http 0.7.1 `serve_dir/backend.rs`, `tokio::fs`); not run,
  because it needs load.
- **Fix:** give the database lanes their own threads, as the hash lane has, or reserve
  separate blocking capacity for file and DNS work, or serve the immutable public files
  from memory. Correct the doc and extend the source test to the host crate.
- **Decided** (Kait, 2026-10-08): database owner threads, a startup index of the public
  files' paths, and a fixed 2–4 thread blocking pool for files and DNS; no preloading,
  because a CDN fronts the host. Recorded in `docs/architecture/native-host.md`; task
  081.34 builds it.

**M7. Vendored OpenSSL ships in the release binary.**

- **Where:** `native/crates/server/Cargo.toml:30`, `openssl` with `vendored`, required by
  `webauthn-rs-core =0.5.5`.
- **Failure:** the release links three crypto libraries (OpenSSL, AWS-LC, ring), and
  OpenSSL parses attacker-supplied COSE keys and signatures on the passkey routes. Its
  fixes arrive only through `cargo update -p openssl-src`. Task 081.28 chose this
  deliberately; the risk is ownership and patching, not a known flaw.
- **Evidence:** code (`cargo tree -i openssl-sys -e features` with default features).
- **Fix:** track `openssl-src` advisories in CI. Later, verify the three signature
  algorithms Snowtime accepts on AWS-LC and drop `webauthn-rs-core`'s OpenSSL. Also switch
  reqwest to `rustls-tls-webpki-roots-no-provider` so ring leaves the graph.

**M8. The V8 library downloads at build time without a content check.**

- **Where:** the `v8 149.4.0` build script, through `deno_core`; `native/Dockerfile:18-21`
  sets neither `RUSTY_V8_ARCHIVE` nor `RUSTY_V8_MIRROR`.
- **Failure:** the build fetches a prebuilt static library from GitHub releases and links
  it into the binary; its "checksum" file records only the URL. The download is cached in
  the build's target mount.
- **Evidence:** code (`v8-149.4.0/build.rs:578-728`).
- **Fix:** download the asset in the Dockerfile, check a pinned SHA-256, and set
  `RUSTY_V8_ARCHIVE`.

**M9. The image ships no third-party notices.**

- **Where:** `native/Dockerfile:33-43`.
- **Failure:** the binary statically links V8 and its Chromium third-party code, OpenSSL,
  AWS-LC, ring, zstd, ICU4X (Unicode-3.0), Mozilla root data (CDLA-Permissive-2.0), and
  eight MPL-2.0 crates; their licenses require notices in binary distributions. The
  licenses themselves are compatible with MIT: no GPL, LGPL, or AGPL in the release graph.
- **Evidence:** `cargo deny check` licenses pass with the allow-list in `native/deny.toml`.
- **Fix:** generate `THIRD_PARTY_LICENSES` with `cargo about`, add V8's, OpenSSL's, and
  AWS-LC's bundled license files, and copy it into the image.

**M10. `BETTER_AUTH_SECRET` has no minimum length.**

- **Where:** `native/crates/host/src/config.rs:74`.
- **Failure:** the host starts with any non-empty secret, which signs session, OAuth-state,
  and passkey cookies. TypeScript refuses fewer than 32 characters (`src/env.ts:34`), so a
  native deployment with a short secret can't fall back to TypeScript unchanged.
- **Evidence:** reproduced (`probe.ts secret`): `BETTER_AUTH_SECRET=x` starts and signs in.
- **Fix:** refuse fewer than 32 characters, and port `env.ts`'s other refusals
  (`MICROSOFT_TENANT_ID` without a client, unknown `NODE_ENV` or `DEMO_MODE` values).

**M11. A precompressed file serves without its base file.**

- **Where:** `native/crates/host/src/edge/mod.rs:31-36`; tower-http opens `path.gz`,
  `.br`, or `.zst` without checking that `path` exists.
- **Failure:** a stray `backup.gz` in the public directory serves at `/backup`, bypassing
  the archive-suffix refusal that checks only the request path. Caddy requires the base
  file. The public directory is build output, which limits this today.
- **Evidence:** reproduced (`probe.ts precompressed`): `/backup.gz` 404, `/backup` with
  `Accept-Encoding: gzip` 200 with the archive's contents.
- **Fix:** serve a static path only when its base file exists. M6's file index does this:
  a variant serves only when its base path is in the index.

### Low

| #   | Where                                                                                                        | Failure                                                                                                                                                                                                                                                                       | Evidence                                                                                         | Fix                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| L1  | `server/src/auth/oauth.rs:462`                                                                               | OAuth redirects without an error URL go to `/api/auth/error`, which native doesn't serve: a stale or reloaded callback lands on a JSON 404. TypeScript serves Better Auth's error page.                                                                                       | Reproduced (`probe.ts errorpage`): 404 `No such call.`                                           | Serve `/api/auth/error`, or redirect errors to `/sign-in?error=`.                                                              |
| L2  | `host/src/edge/mod.rs:53-54`                                                                                 | A request past `EDGE_TIMEOUT_SECONDS` gets 408 while its blocking write still commits; browsers may resend a request after 408.                                                                                                                                               | Reproduced in H1: 408 at 30 s with the parse still holding the writer.                           | Answer 503 with `Retry-After`, or 504.                                                                                         |
| L3  | `server/src/clock.rs:15-20`                                                                                  | `PERF_NOW` moves the clock in release builds without a log line: a leftover value shifts every expiry, and extreme values overflow.                                                                                                                                           | Code.                                                                                            | Gate it behind `bench` or development, log it, use checked arithmetic.                                                         |
| L4  | `host/src/health.rs:32-33`                                                                                   | `/livez` and `/readyz` are public: `/readyz` discloses whether rate limits are off, and neither is a reserved slug (`src/lib/app-paths.ts:19`), so an organization with that slug loses its page.                                                                             | Code.                                                                                            | Reserve both slugs on both backends; drop `rate_limit` from the public body or serve health on a separate port.                |
| L5  | `server/src/client_ip.rs:13-21`                                                                              | `CLIENT_IP_HEADER` is trusted from any peer; Caddy checked trusted proxy ranges. A client reaching the origin directly spoofs its address, bypassing per-address limits. The README puts this on the firewall.                                                                | Code.                                                                                            | Add `CLIENT_IP_TRUSTED_PROXIES` and fall back to the peer address.                                                             |
| L6  | `host/src/edge/mod.rs:171`; rustls-acme `caches/dir.rs:31`                                                   | ACME account and certificate keys are written with the default umask (usually 0644) inside the 0700 directory; a copy that drops the directory mode exposes them. The chmod also applies to a shared directory if one is configured.                                          | Code.                                                                                            | Write the cache files 0600 and document a dedicated directory.                                                                 |
| L7  | `host/src/pages.rs:165`                                                                                      | A failed render logs the path with its query string; the README says logs omit query strings.                                                                                                                                                                                 | Code.                                                                                            | Log `uri().path()` only.                                                                                                       |
| L8  | `host/src/pages.rs:22-35`; `render/bundle/entry.tsx`                                                         | The in-process transport forwards whatever method, path, and headers page JavaScript sets, including `Origin` and the client-address header, and the session cookie lives in JavaScript. In-process calls carry no client address, so a future limit there shares one bucket. | Code.                                                                                            | Allow only `/api/v1` reads, drop `Origin`, `Host`, and the address header, and attach the cookie and client address host-side. |
| L9  | `render/src/lib.rs:274-303`                                                                                  | Leftover async work from one page can run during the next user's page with that user's cookie. Nothing in the bundle leaves such work today.                                                                                                                                  | Code.                                                                                            | Reset the isolate when ops or timers remain after a render; tie each API call to its render.                                   |
| L10 | `render/src/lib.rs:266-298`                                                                                  | A page that finishes as the watchdog fires keeps a pending termination; the next page fails with 500 and resets the isolate.                                                                                                                                                  | Code.                                                                                            | Cancel termination after disarming on success.                                                                                 |
| L11 | `render/src/lib.rs:479-483`, `:528-537`; `:623-651`                                                          | A renderer blocked outside JavaScript is never detected, and a pool marked down never recovers; health keeps the host alive by design.                                                                                                                                        | Code.                                                                                            | Track busy time per renderer; retry the pool after a cool-down.                                                                |
| L12 | `render/src/lib.rs:282-291`                                                                                  | A client that disconnects mid-render forces an isolate rebuild, losing JIT warmth.                                                                                                                                                                                            | Code.                                                                                            | Let a started render finish within its deadline and discard it.                                                                |
| L13 | `server/src/auth/writes.rs:442-446`, `:644-679`; `auth/acceptance.rs:191-194`; `auth/invitations.rs:126-151` | Multi-statement auth writes aren't one transaction: a failure between statements can leave an organization without an owner or a removed member in a team. TypeScript has the same splits.                                                                                    | Code.                                                                                            | Wrap each flow in one immediate transaction.                                                                                   |
| L14 | Every `unchecked_transaction()` (11 sites, for example `projects/mod.rs:158`)                                | Deferred transactions fail with `SQLITE_BUSY` at once if another process wrote in between; the timer's transaction is already immediate.                                                                                                                                      | Code; whether Litestream writes often enough needs a check.                                      | Use `TransactionBehavior::Immediate` everywhere.                                                                               |
| L15 | `server/src/queries.rs:47-49`, `:83-87`; `auth/passkeys.rs:99-103`                                           | `Sql::literal` accepts any `&str`, and `passkeys::keys` formats a column name into SQL. Every current caller passes a literal.                                                                                                                                                | Code.                                                                                            | Take `&'static str` or an enum; keep `literal` crate-private.                                                                  |
| L16 | `server/src/auth/sign_in.rs:230`                                                                             | The password limit counts code points; Better Auth counts UTF-16 units, so 65–128 astral characters pass natively.                                                                                                                                                            | Code.                                                                                            | Count `encode_utf16()`. Fixed in 081.31 ([input bounds](31-input-bounds.md)).                                                  |
| L17 | `server/src/auth/schemas.rs:496-505`; `writes.rs:305`, `:442`, `:515`; `passkeys.rs:310`; `http.rs:264`      | Unbounded inputs, as in Better Auth but now without a proxy: one issue string per `scopes` element (a 2 MiB array answers about 60 MB), and no caps on image, logo, metadata, passkey name, or stored user agent.                                                             | Code.                                                                                            | Cap issues and array length; cap each stored string. Fixed in 081.31 ([input bounds](31-input-bounds.md)).                     |
| L18 | `host/src/edge/mod.rs`, `server/src/http.rs`                                                                 | No `CatchPanicLayer`: a panic in async handler code resets the connection instead of answering 500. Blocking code already maps panics to 500.                                                                                                                                 | Code.                                                                                            | Add `CatchPanicLayer` with the API's JSON 500.                                                                                 |
| L19 | `server/src/auth/oauth.rs:742-748`                                                                           | A provider's `expires_in` multiplies without overflow checks.                                                                                                                                                                                                                 | Code.                                                                                            | `checked_mul` and `checked_add`. Fixed in 081.31 ([input bounds](31-input-bounds.md)).                                         |
| L20 | `server/src/rate_limit.rs:60-64`                                                                             | Above 10,000 live windows, every write prunes the whole map under one mutex.                                                                                                                                                                                                  | Code.                                                                                            | Prune on a timer or after the map doubles.                                                                                     |
| L21 | `native/README.md:207-210`; `native/bench/compare.ts`                                                        | The README's commands build without `bench`, but OAuth conformance and `compare.ts` need it for the fake provider, so they fail. `compare.ts`'s mask turns `updatedAt` into `$created` when both match to the millisecond, which failed one run of 1,361.                     | Reproduced: OAuth conformance fails without `bench`; [compare-run1.log](audit/compare-run1.log). | Document `--features bench`; mask each field by name.                                                                          |
| L22 | `native/crates/server/Cargo.toml:9-19`                                                                       | The `auth-spike` feature keeps alpha `better-auth` crates and `rsa` (RUSTSEC-2023-0071) in the lockfile, failing `cargo deny --all-features`.                                                                                                                                 | [cargo-deny-all-features.log](audit/cargo-deny-all-features.log).                                | Remove the spike before the split.                                                                                             |
| L23 | `native/Dockerfile:7`, `:33`; workspace                                                                      | Base images pinned by tag, no `rust-toolchain.toml`, no `[workspace.lints]` for `unsafe`, and no CI job runs cargo.                                                                                                                                                           | Code.                                                                                            | Pin digests and the toolchain; add the lints and a cargo CI job.                                                               |
| L24 | Conformance suites                                                                                           | No native test uses another organization's IDs; TypeScript's unit tests do. The code is correct today.                                                                                                                                                                        | Code.                                                                                            | Add a second-organization fixture to conformance.                                                                              |

### Info

- **Parity differences where native is stricter:** a UTF-8 BOM, invalid UTF-8, lone
  surrogate escapes, numbers beyond f64, and nesting past 128 answer 400 natively;
  TypeScript accepts them. Validation messages format some numbers differently (`1.0`
  for `1`). Duplicate `additionalParams` keys go to the provider twice.
- **Shared with TypeScript:** neither backend re-sends the session cookie when
  `GET /api/v1/session` renews the session, so the browser's 30-day cookie can expire
  before the row. TypeScript also answered from its cookie cache without renewing
  ([renewal.log](audit/repro/renewal.log)). `remove-member` reveals whether a foreign
  member ID is an owner, as Better Auth 1.7.7 does. HEAD on a GET route is checked as a
  write on both.
- **Edge differences from Caddy:** the access log has no client address or user agent;
  any Host or SNI gets the app; certificate files reload only on restart; no OCSP
  stapling. Scanner probes render the app's 404 page in V8 instead of Caddy's cheap 404.
- `Set-Cookie` headers from in-process API calls don't reach the page response.
- Sign-out answers one `Set-Cookie` per duplicate cookie name in the request.
- The edge's 413 for an oversized `Content-Length` is text/plain; the API's is JSON.
- Carried over from [29](29-hardening.md#remaining-open-items): the year-0000 report bounds
  differ from TypeScript. This audit didn't investigate it further.

### Dropped

- **Session renewal without a cookie** was reported as a native gap; TypeScript behaves
  the same on this route (Info above).
- **Rate-limit bypass through path variants:** case, `//`, percent-encoding, and trailing
  slashes don't route in Axum, so they can't reach a handler under a different key.
- **Network ops as SSRF:** they panic before connecting (M2), so they can't reach the
  network.

## Coverage

What each reviewer checked and found sound.

**Route table.** All 41 `/api/v1` routes on both sides, and the 23 Better Auth paths the
client uses, with method, extractor, scope, and role. Every tenant query constrains
`organization_id` or uses IDs already checked against it: entries, projects (including
`project_team` and the delete's entry check), teams (`assert_team_in_scope` before every
membership write), timer, reports (`entries_where` always starts with the organization),
invitations, and organization writes. Unknown `/api/v1` paths, wrong methods, trailing
slashes, and OPTIONS answer the JSON 404; the edge sends unknown `/api` paths, dotfiles,
and archive probes back to the API router, so the renderer never answers them. Check
order (404, origin, 401, scope, input) matches Hono apart from an invalid-UTF-8 path
answering 400 first.

**Auth.** Signed cookies: HMAC-SHA256, constant-time comparison, first duplicate wins,
`__Secure-` only on HTTPS, `HttpOnly` and `SameSite=Lax`. Sessions: expiry and renewal
arithmetic, deleted users, membership checked per call. Origin and CSRF on every write,
including Better Auth's Referer fallback and form checks. Redirect URLs refuse `//`, `\`,
control characters, encoded slashes, `javascript:`, and other hosts. OAuth state is
random, single-use, expiring, and bound to a signed cookie and S256 PKCE; linking
requires verified matching emails; unlink refuses the last account. Passkey challenges
are single-use, expiring, bound to the session's user, with exact RP ID and origin and
the counter check. Password sign-in hashes for unknown users and caps length. Client
addresses: socket address directly, one valid header in proxy mode, IPv6 grouped by /64.

**Input handling.** 2 MiB body caps hold with the edge layer off. JSON depth stops cleanly
at 128. Duplicate keys are last-wins. Strings count UTF-16 units after JS-equivalent
trimming everywhere except L16. Timestamps, ranges, cursors, and page cuts are bounded.
Cookie, header, and Location handling can't panic. Every item of 081.29's panic list was
rechecked, and `host/src` (pages, edge, health), outside its scope, has no
request-reachable panic either.

**SQL.** The `sql!` macro binds every non-literal; every `format!` building SQL uses a
constant or a literal caller (L15). No runtime identifiers; report grouping is a fixed
match. No LIKE anywhere. Readers open read-only with `query_only`. Single-use tokens are
consumed atomically on the writer. Timer start holds its checks in one immediate
transaction. Empty `list()` matches no rows, as Drizzle's `inArray([])` does. Timestamps
are milliseconds throughout.

**Edge and configuration.** Missing database URL, app URL, or secret refuse to start; the
app URL must be an HTTP(S) origin. Password sign-in is off and rate limits on unless
development. Certificate files and ACME are exclusive and need HTTPS; wildcard ACME
domains are refused. Security headers match the Caddyfile, including on error
responses; API responses send `no-store`. Static paths refuse traversal, absolute paths,
dotfiles in any segment, archive suffixes, and directory listing. The HTTP redirect uses
the configured origin. Logs carry no cookies, authorization, or provider tokens.

**Render host.** Ops: `op_send`, `op_head`, `op_chunk`, `op_render_encode`, plus the Deno
extensions in M2; no file system, process, or environment access, and `fetch` throws.
The snapshot holds no user data; failed renders replace the isolate; successful ones
clear the cookie, context, locale, and Solid's shared context; each page builds its own
router and query client. Pages accept only GET and HEAD, and in-process calls carry no
`Origin`, so a render can't write. Deadlines cover synchronous loops and pending
promises. Pages cap at 8 MiB. Dehydration escapes `<`; the nonce is 16 random bytes.

**Concurrency.** Admission is bounded by count and time with one shared deadline; no await
sits between taking a permit and spawning, so a dropped caller can't leak one. Permits
release on panic. The writer mutex recovers from poisoning, and transactions roll back on
unwind. Session renewal from a reader never waits on the writer. The hash lane runs
only on its own threads, skips callers that left, and survives panics. The render queue
is bounded and withdraws dropped pages with their API calls. h2 0.4.19 includes the
rapid-reset and CONTINUATION fixes.

**Dependencies.** All sources are crates.io; no git, patch, or replace entries; the
lockfile is committed and the image builds `--locked`. One version each of rustls,
rustls-webpki, ring, aws-lc-rs, aws-lc-sys, hyper, h2, tokio, and openssl. Every `unsafe`
block in the workspace (scrypt FFI, thread priority, `mktime`, `sysconf`, simdutf
conversions, `malloc_trim`) holds its invariant. No environment mutation. Release
features exclude `bench`, `api-bench`, `scrypt-bench`, and `auth-spike`. The binary runs
as a non-root user.

## Dependency checks

`cargo audit` 0.22.2 against 1,294 advisories, on 621 locked crates:
[cargo-audit.log](audit/cargo-audit.log).

| Advisory          | Crate                            | Reached through                        | In the release graph | Finding                             |
| ----------------- | -------------------------------- | -------------------------------------- | -------------------- | ----------------------------------- |
| RUSTSEC-2026-0285 | rustls 0.23.40                   | edge TLS; pinned by `deno_tls`         | Yes                  | M3                                  |
| RUSTSEC-2026-0119 | hickory-proto 0.25.2             | `deno_net`, `deno_fetch`               | Yes, unused          | M3                                  |
| RUSTSEC-2026-0118 | hickory-proto 0.25.2             | `deno_net`, `deno_fetch`               | Yes, unused          | M3                                  |
| RUSTSEC-2023-0071 | rsa 0.9.10                       | `auth-spike` (`jsonwebtoken`)          | No                   | L22                                 |
| RUSTSEC-2026-0097 | rand 0.8.5 (unsound)             | `deno_fs`; `auth-spike`                | Yes, unused API      | None                                |
| Unmaintained      | bincode 1, paste, rustls-pemfile | `deno_core`, `v8`, `deno_native_certs` | Yes                  | Ignored with reasons in `deny.toml` |

`cargo deny` 0.20.2 with the new `native/deny.toml`: licenses, bans, and sources pass;
advisories fail on the vulnerabilities above, which `deny.toml` deliberately doesn't
ignore ([cargo-deny.log](audit/cargo-deny.log),
[all features](audit/cargo-deny-all-features.log)). Duplicate versions are warnings, all
from upstream crates.

## Parity record

`git diff main -- src` is empty against `main` at `c8ffa84`, which this branch contains.
`native/README.md` records "feature level: matches snowtime main c8ffa84" with these
counts.

Full verification, 2026-10-08, macOS arm64, at `a20713f`
([summary.log](audit/summary.log) and the logs beside it):

- `cargo fmt --check` and workspace Clippy with all targets and warnings denied, with
  and without `bench`, pass.
- Server tests: 83 pass without `bench`, 83 with it. Host tests: 17 pass.
- Full HTTP conformance through `native/bench/conformance.ts`, one fresh fixture per file:
  49 tests, 511 assertions, all pass across 10 files. The OAuth file needs the `bench`
  build (L21); the first run used a default build and failed it, and the rerun on the
  `bench` build passes ([conformance-oauth-bench.log](audit/conformance-oauth-bench.log)).
- `compare.ts` on the `bench` build: 1,361 calls, all byte-equal, exit 0. A first run had
  one masking difference (L21).

No Docker, load, or stress runs. The reproductions run local hosts on copies of the
benchmark database:

```sh
bun native/bench/audit/probe.ts native/target/debug/snowtime-axum
bun native/bench/audit/renewal.ts native/target/debug/snowtime-axum
```

`probe.ts` takes experiment names (`domains`, `orderedjson`, `slowloris`, `ratekeys`,
`verification`, `errorpage`, `precompressed`, `secret`, `renewal`, `migrations`) to run a
subset. The renderer tests in [render-tests.rs.txt](audit/repro/render-tests.rs.txt) were
appended to the render crate's tests, run one at a time, and removed.

## Recommended order

1. H1, H2, H3, and M1: correctness and availability defects with small fixes.
2. M2 and M3 together: removing `deno_net` and `deno_fetch` closes the abort path and frees
   the rustls update.
3. M4–M6 and M10–M11, then the supply-chain items M7–M9 and L22–L23 before the split, so
   the new repository starts with CI checks and notices.
4. The low findings as they touch nearby code.
