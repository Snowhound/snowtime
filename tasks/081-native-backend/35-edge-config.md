# 081.35: Edge configuration

Status: done

Fix M10, L3–L7, L20, and the edge's 413 from task 081.30, the 081.32 follow-up on the
login-domain session check, and the CDN keep-alive defaults Kait asked for on 2026-10-09.
Branch `081-edge-config`, from `081-audit` at `c7634a5`. 081.34's file index already fixed
M11.

## Acceptance criteria

- [x] M10: the host refuses a `BETTER_AUTH_SECRET` under 32 UTF-16 units, as valibot counts,
      `MICROSOFT_TENANT_ID` without `MICROSOFT_CLIENT_ID`, a `CLIENT_IP_HEADER` outside
      `/^[a-z0-9-]+$/`, and `NODE_ENV` or `DEMO_MODE` outside `src/env.ts`'s values. The
      tenant refusal uses TypeScript's message. The production flag still needs
      `NODE_ENV=production`: Better Auth reads `process.env.NODE_ENV` at run time through
      a proxy, the server build doesn't inline it, and nothing in the build sets it, so an
      unset value isn't production for its OAuth error redirects.
- [x] M11: `probe.ts precompressed` serves the page at `/backup`, and the edge test
      `a_precompressed_file_serves_only_beside_its_base_file` passes; 081.34 marked it.
- [x] L3: `PERF_NOW` moves the clock only in `bench` and debug builds. It takes 0 through
      JavaScript's largest date, the host logs a warning with the moment, and `now()`
      saturates. Other builds refuse to start with it set.
- [x] L4: `/readyz` no longer reports `rate_limit`; the startup log still does.
      `hardening-compare.ts` checks the body instead of reading the flag.
- [x] L4: `livez` and `readyz` are reserved slugs on both backends, in a commit that
      touches only the two slug lists, so it can go to `main` on its own.
- [x] L5: with `CLIENT_IP_TRUSTED_PROXIES` (comma-separated CIDRs), the host reads
      `CLIENT_IP_HEADER` only from a peer in those ranges and uses the peer's address for
      any other. The variable needs `CLIENT_IP_HEADER`.
- [x] L6: `PrivateDirCache` wraps rustls-acme's `DirCache`: the directory is 0700 and each
      `cached_*` file 0600, both at startup and after each store; other files keep their
      mode. The README asks for a dedicated
      `ACME_CACHE_DIR`.
- [x] L7: a failed render logs the path without the query string.
- [x] 413: past `EDGE_BODY_LIMIT_BYTES`, a declared length on an `/api` path gets the API's
      JSON refusal; other paths keep tower-http's plain text.
- [x] L20: the write-rate window map prunes ended windows once it holds twice what the last
      pruning kept, and at least 10,000.
- [x] 081.32 follow-up: `login_domain_middleware` reads the session on a reader, as the
      API's session check does. Only renewal or expiry takes the writer, and only when
      it's free. `compare.ts` stays byte-equal.
- [x] CDN keep-alive: a connection from a peer in `CLIENT_IP_TRUSTED_PROXIES` closes after
      `EDGE_PROXY_IDLE_TIMEOUT_SECONDS` (default 920) with nothing in flight and has no
      per-address cap. Other peers keep the cap and close after 30 seconds by default.
      Without listed proxies, the 30- and 60-second defaults are unchanged.
- [x] `native/README.md` documents each new or changed setting.

## Keep-alive and hyper

hyper 1.11 can't time out a partial request head separately from an idle keep-alive wait.
Its HTTP/1 dispatcher calls `poll_read_head` as soon as a connection returns to
`Reading::Init`, and that call starts `header_read_timeout`'s timer before any byte of the
next request arrives (`proto/h1/conn.rs:219`). hyper has no separate idle timeout, and
axum-server gives every connection of a listener the same builder.

The acceptor knows each peer's address before hyper takes the connection, so it sets the
window per peer. With listed proxies, hyper's header timeout is the longer of
`EDGE_HEADER_TIMEOUT_SECONDS` and `EDGE_PROXY_IDLE_TIMEOUT_SECONDS`, and the acceptor's idle
timer does the rest: a listed proxy's connection closes after the proxy timeout with
nothing in flight. Any other peer's closes after the shorter of the header and idle
timeouts. A partial head or a keep-alive wait has nothing in flight, so it closes at 30
seconds, as with hyper's timer. A silent connection from another peer also closes at 30
seconds rather than 60. A CDN's ranges are shared by its customers, so the README still
recommends a firewall or Authenticated Origin Pulls in addition to the listed ranges.

## Tests

| Finding        | Test                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M10            | `config::tests::env_ts_refusals_hold_natively`                                                                                                                           |
| L3             | `clock::tests::perf_now_refuses_values_outside_dates`                                                                                                                    |
| L4             | `health::tests::the_api_serves_while_the_render_lane_is_down`, `hardening-compare.ts`                                                                                    |
| L5             | `client_ip::tests::listed_proxies_alone_may_set_the_address`, and a host config test                                                                                     |
| L6             | `edge::acme_cache::tests::the_cache_keeps_its_directory_and_files_private`                                                                                               |
| L7             | `pages::tests::a_failed_render_logs_the_path_without_its_query`                                                                                                          |
| 413            | `edge::tests::body_limit_rejects_oversized_requests_in_the_apis_format_on_its_paths`                                                                                     |
| L20            | `rate_limit::tests::ended_windows_are_pruned_once_the_map_doubles`                                                                                                       |
| Login domains  | `http::tests::the_login_domain_check_reads_while_the_writer_is_busy`                                                                                                     |
| Proxy windows  | `edge::tests::only_listed_proxies_keep_partial_heads_and_idle_connections_open_longer`, `connections::tests::a_proxy_has_no_per_address_cap_but_counts_toward_the_total` |
| CDN keep-alive | `edge::tests::connection_limits_and_timeouts_default_by_proxy_and_refuse_zero_timeouts`                                                                                  |

The proxy-window test uses a 1-second header timeout and a 3-second proxy timeout:
partial heads and kept-alive connections from 127.0.0.1 close after about 3 seconds when
it's listed, and after about 1 second when it isn't.

The login-domain test holds the writer and expects both a current and a renewal-due
session to be checked within 200 ms. Against the previous middleware, it fails.

## Verification

Run 2026-10-09 on macOS arm64. `cargo fmt --check`, both Clippy runs, the `bench` build,
a release `cargo check` of the server crate, and `bunx tsc --noEmit` passed. A fresh
worktree also needs `bun install` in `native/bench/auth-spike` and
`native/crates/render/bundle/bench` before `tsc` passes.

| Check                   | Baseline `c7634a5` | `dd19982`     | Review fixes  |
| ----------------------- | ------------------ | ------------- | ------------- |
| Server tests, each mode | 118                | 122           | 122           |
| Host tests              | 29                 | 33            | 35            |
| Render tests            | 18, 1 ignored      | 18, 1 ignored | 18, 1 ignored |
| Conformance             | 54 / 539           | 54 / 539      | 54 / 539      |
| `compare.ts` byte-equal | 1,409              | 1,409         | 1,409         |
| `hardening-compare.ts`  | 17 checks          | 17            | 17            |
| `page-compare.ts`       | 59 / 59            | 59 / 59       | 59 / 59       |

Conformance counts are tests and assertions across 11 files. `page-compare.ts` compares
against the baseline binary built with this worktree's render bundle. Bundles built in
different worktrees differ in one chunk's hash, so a comparison across worktrees reports
35 pages as different.

## Probes

`bun native/bench/audit/probe.ts native/target/debug/snowtime-axum secret precompressed
slowloris domains`, on the `bench` build:

| Probe                                 | Baseline `c7634a5`             | After                          |
| ------------------------------------- | ------------------------------ | ------------------------------ |
| `BETTER_AUTH_SECRET=x`                | Starts and signs in            | Exits 101                      |
| `/backup.gz`                          | 404                            | 404                            |
| `/backup` with gzip, only `backup.gz` | 200, the rendered page         | 200, the rendered page         |
| Partial headers, direct               | Closed after 30.0 s            | Closed after 30.0 s            |
| Idle keep-alive, direct               | Closed after 30.0 s            | Closed after 30.0 s            |
| Partial headers, listed proxy         | Not run                        | Open after 45 s                |
| Idle keep-alive, listed proxy         | Not run                        | Open after 45 s                |
| Partial headers, unlisted peer        | Not run                        | Closed after 30.0 s            |
| Idle keep-alive, unlisted peer        | Not run                        | Closed after 30.0 s            |
| Blocked-domain session, timer         | 401                            | 401                            |
| Blocked-domain session, session read  | 200 `null`                     | 200 `null`                     |
| Blocked-domain session, project write | 401                            | 401                            |
| Password sign-in, blocked domain      | 403 `LOGIN_DOMAIN_NOT_ALLOWED` | 403 `LOGIN_DOMAIN_NOT_ALLOWED` |

Baseline results come from the runs recorded in 081.30, 081.32, and 081.34; the direct
keep-alive row is 081.34's reading client. `slowloris` now reads each response, so the
close after a keep-alive wait shows, and it runs three ways: direct, with
`CLIENT_IP_TRUSTED_PROXIES=127.0.0.1` (the probe's peer is a listed proxy), and with
`192.0.2.0/24` (an unlisted peer), each at the default timeouts.
