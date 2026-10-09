# 081.35: Edge configuration

Status: in-progress

Fix M10, L3–L7, L20, and the edge's 413 from task 081.30, the 081.32 follow-up on the
login-domain session check, and the CDN keep-alive defaults Kait asked for on 2026-10-09.
Branch `081-edge-config`, from `081-audit` at `c7634a5`. 081.34's file index already fixed
M11.

## Acceptance criteria

- [x] M10: the host refuses a `BETTER_AUTH_SECRET` under 32 UTF-16 units, as valibot counts,
      `MICROSOFT_TENANT_ID` without `MICROSOFT_CLIENT_ID`, and `NODE_ENV` or `DEMO_MODE`
      outside `src/env.ts`'s values. The tenant refusal uses TypeScript's message. An
      unset `NODE_ENV` counts as production, as in `env.ts`.
- [x] M11: `probe.ts precompressed` serves the page at `/backup`, and the edge test
      `a_precompressed_file_serves_only_beside_its_base_file` passes; 081.34 marked it.
- [x] L3: `PERF_NOW` moves the clock only in `bench` and debug builds. It takes 0 through
      JavaScript's largest date, the host logs a warning with the moment, and `now()`
      saturates. Other builds refuse to start with it set.
- [x] L4: `/readyz` no longer reports `rate_limit`; the startup log still does.
      `hardening-compare.ts` checks the body instead of reading the flag.
- [ ] L4: reserve the `livez` and `readyz` slugs on both backends, in a separate commit
      that touches only the slug lists. Waiting for Kait.
- [x] L5: with `CLIENT_IP_TRUSTED_PROXIES` (comma-separated CIDRs), the host reads
      `CLIENT_IP_HEADER` only from a peer in those ranges and uses the peer's address for
      any other. The variable needs `CLIENT_IP_HEADER`.
- [x] L6: `PrivateDirCache` wraps rustls-acme's `DirCache`: the directory is 0700 and each
      file 0600, both at startup and after each store. The README asks for a dedicated
      `ACME_CACHE_DIR`.
- [x] L7: a failed render logs the path without the query string.
- [x] 413: past `EDGE_BODY_LIMIT_BYTES`, a declared length on an `/api` path gets the API's
      JSON refusal; other paths keep tower-http's plain text.
- [x] L20: the write-rate window map prunes ended windows once it holds twice what the last
      pruning kept, and at least 10,000.
- [x] 081.32 follow-up: `login_domain_middleware` reads the session on a reader, as the
      API's session check does. Only renewal or expiry takes the writer, and only when
      it's free. `compare.ts` stays byte-equal.
- [x] CDN keep-alive: with `CLIENT_IP_HEADER` set, `EDGE_HEADER_TIMEOUT_SECONDS` and
      `EDGE_IDLE_TIMEOUT_SECONDS` default to 920; without it they stay 30 and 60.
- [x] `native/README.md` documents each new or changed setting.

## Keep-alive and hyper

hyper 1.11 can't time out a partial request head separately from an idle keep-alive wait.
Its HTTP/1 dispatcher calls `poll_read_head` as soon as a connection returns to
`Reading::Init`, and that call starts `header_read_timeout`'s timer before any byte of the
next request arrives (`proto/h1/conn.rs`). hyper has no separate idle timeout. With the
920-second defaults behind a CDN, a client that sends part of a head can hold a connection
for 920 seconds. The origin must therefore accept connections only from the CDN: a
firewall allow-list of its ranges, or Cloudflare's Authenticated Origin Pulls.
`native/README.md` records this.

The acceptor could time out a head itself later: start a timer at the first byte read
while no request is in flight, and clear it when the service is called. That would allow
a short header timeout with a long idle window. This task doesn't build it.

## Tests

| Finding        | Test                                                                                    |
| -------------- | --------------------------------------------------------------------------------------- |
| M10            | `config::tests::env_ts_refusals_hold_natively`                                          |
| L3             | `clock::tests::perf_now_refuses_values_outside_dates`                                   |
| L4             | `health::tests::the_api_serves_while_the_render_lane_is_down`, `hardening-compare.ts`   |
| L5             | `client_ip::tests::listed_proxies_alone_may_set_the_address`, and a host config test    |
| L6             | `edge::acme_cache::tests::the_cache_keeps_its_directory_and_files_private`              |
| L7             | `pages::tests::a_failed_render_logs_the_path_without_its_query`                         |
| 413            | `edge::tests::body_limit_rejects_oversized_requests_in_the_apis_format_on_its_paths`    |
| L20            | `rate_limit::tests::ended_windows_are_pruned_once_the_map_doubles`                      |
| Login domains  | `http::tests::the_login_domain_check_reads_while_the_writer_is_busy`                    |
| CDN keep-alive | `edge::tests::connection_limits_and_timeouts_default_by_proxy_and_refuse_zero_timeouts` |

The login-domain test holds the writer and expects both a current and a renewal-due
session to be checked within 200 ms. Against the previous middleware, it fails.

## Verification

Run 2026-10-09 on macOS arm64. `cargo fmt --check`, both Clippy runs, the `bench` build,
a release `cargo check` of the server crate, and `bunx tsc --noEmit` passed. A fresh
worktree also needs `bun install` in `native/bench/auth-spike` and
`native/crates/render/bundle/bench` before `tsc` passes.

| Check                   | Baseline `c7634a5` | 081.35        |
| ----------------------- | ------------------ | ------------- |
| Server tests, each mode | 118                | 122           |
| Host tests              | 29                 | 33            |
| Render tests            | 18, 1 ignored      | 18, 1 ignored |
| Conformance             | 54 / 539           | 54 / 539      |
| `compare.ts` byte-equal | 1,409              | 1,409         |
| `hardening-compare.ts`  | 17 checks          | 17            |
| `page-compare.ts`       | 59 / 59            | 59 / 59       |

Conformance counts are tests and assertions across 11 files. `page-compare.ts` compares
against the baseline binary built with this worktree's render bundle. Bundles built in
different worktrees differ in one chunk's hash, so a comparison across worktrees reports
35 pages as different.

## Probes

`bun native/bench/audit/probe.ts native/target/debug/snowtime-axum secret precompressed
slowloris domains`, on the `bench` build:

| Probe                                 | Baseline `c7634a5`             | After                                |
| ------------------------------------- | ------------------------------ | ------------------------------------ |
| `BETTER_AUTH_SECRET=x`                | Starts and signs in            | Exits 101                            |
| `/backup.gz`                          | 404                            | 404                                  |
| `/backup` with gzip, only `backup.gz` | 200, the rendered page         | 200, the rendered page               |
| Partial headers                       | Closed after 30.0 s            | Closed after 30.0 s                  |
| Idle keep-alive after one response    | Open after 45 s in probe       | Open after 45 s in probe; see 081.34 |
| Blocked-domain session, timer         | 401                            | 401                                  |
| Blocked-domain session, session read  | 200 `null`                     | 200 `null`                           |
| Blocked-domain session, project write | 401                            | 401                                  |
| Password sign-in, blocked domain      | 403 `LOGIN_DOMAIN_NOT_ALLOWED` | 403 `LOGIN_DOMAIN_NOT_ALLOWED`       |

Baseline results come from the runs recorded in 081.30, 081.32, and 081.34. The probes
run without `CLIENT_IP_HEADER`, so the 30-second header timeout applies.
