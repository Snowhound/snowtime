# 081.36: Renderer fixes from the audit

Status: done

Fix M2, M3, and L8–L12 from task 081.30 on branch `081-render`, from `081-audit` at
`d67ba4c`. Kait decided on 2026-10-08 to drop `deno_net` and `deno_fetch` rather than
disable their ops. Pages must render the same bytes.

## Acceptance criteria

- [x] `deno_net` and `deno_fetch` leave the render crate. Headers, Request, and Response
      come from deno_fetch 0.276.0's scripts in `native/crates/render/vendor/deno_fetch`,
      unchanged except `22_http_client.js`, which drops `createHttpClient`. The isolate
      registers 360 ops, down from 443, and none matches
      `net|fetch|dns|tls|socket|tcp|udp|unix|http` (`no_network_op_is_registered`).
- [x] rustls is 0.23.45, and `deno_tls`, `deno_native_certs`, and `hickory-proto` are out
      of the lockfile. Neither `cargo audit` nor `cargo deny check` reports
      RUSTSEC-2026-0285, -0118, or -0119; `deny.toml` drops the unused rustls-pemfile
      ignore.
- [x] The near-heap-limit callback grants one fixed 1 GiB headroom, V8's largest object,
      and the renderer replaces an isolate whose limit it raised. The audit's large array,
      a 128 MiB string at a 64 MiB heap, and a string past V8's maximum length fail the
      page and the next page renders (`a_page_past_the_heap_limit_fails_without_aborting`).
- [x] Each API answer is read up to `max_api_response_bytes` (4 MiB), and a page's answers
      together up to `max_api_bytes` (16 MiB). The host stops reading at the limit, and the
      page fails with 500 even if its JavaScript catches the error.
- [x] L8: the in-process transport allows GET under `/api/v1` and POST to the five report
      reads, keeps only `Content-Type` and `Accept` from the page's headers, and attaches the
      page's cookie and client address itself: the configured `CLIENT_IP_HEADER` and
      `ConnectInfo`. The bundle no longer adds the cookie.
- [x] L9: a page that leaves API calls or timers pending is served, and its isolate is
      replaced.
- [x] L10: disarming the watchdog cancels a termination it requested as the page finished.
- [x] L11: the pool records when each renderer started its page; one past `stuck_after`
      (10 s) makes `health()` degraded. A pool past its restart budget starts its
      renderers again after `down_retry` (60 s).
- [x] L12: a page whose client leaves after a renderer took it renders to its end or
      deadline, and its answer is dropped. A queued page is still withdrawn at once.
- [x] Pages render the same bytes: `native/bench/page-compare.ts` renders 59 pages and
      requests on the `d67ba4c` build and on this one, all byte-equal.
- [x] 30-audit.md marks each finding "Fixed in 081.36"; the READMEs and
      `docs/architecture/native-rendering.md` and `native-host.md` describe the new
      behavior.

## M2 reproductions

The audit's temporary tests ([render-tests.rs.txt](audit/repro/render-tests.rs.txt)), run
at `d67ba4c` and again as the crate's tests on this branch, at a 64 MiB heap:

| Page script                                      | `d67ba4c`                                      | 081.36                        |
| ------------------------------------------------ | ---------------------------------------------- | ----------------------------- |
| Gradual growth, `a.push(new Array(1e5))` forever | Page fails: execution terminated               | Same                          |
| `new Array(3e7).fill(1.5)`                       | Fatal JavaScript out of memory, SIGTRAP        | Page fails; next page renders |
| `('x'.repeat(1 << 27) + 'y').toUpperCase()`      | Not run                                        | Page fails; next page renders |
| `'x'.repeat(2 ** 29)`                            | Not run                                        | Page fails with `RangeError`  |
| `('x'.repeat(1 << 27) + 'y').split('')`          | Fatal JavaScript invalid size error, SIGTRAP   | Same, at any heap limit       |
| `op_net_connect_tcp`                             | Panic in a function that can't unwind, SIGABRT | The op doesn't exist          |

The audit's string case still aborts. `split('')` builds an array of 2^27 + 1 elements,
past V8's array maximum, and V8 ends the process with "invalid size" before any heap
check runs, at any heap limit; no isolate setting turns it into an exception.
`splitting_a_string_into_too_many_elements_aborts_in_v8` keeps it as an ignored test.
Patching `String.prototype.split` would cover one builtin of several that build arrays
this way, so it isn't done. A builtin that makes two allocations of close to 1 GiB before
it checks for termination also exceeds any one headroom: `new Array(1.3e8).fill(1.5)`
still aborts with 1.1 GiB of headroom, after the process reached 2.3 GB. Only rendering
in a child process, as the parked Bun sidecar would, contains both.

The headroom is address space, used only by a page that allocates it before its
termination lands. Under a cgroup limit below the renderer's heap plus that allocation,
the kernel ends the process instead; a smaller headroom would end it as well, in V8.

## Behavior changes

- An API call the host refuses or can't complete (a disallowed method or path, an answer
  over the limit, a panicked handler) fails the page with 500. Before, the page's
  JavaScript got a rejected call and could render an error state.
- In-process API calls carry the page's client address, so per-address limits count a
  page's calls against its client rather than one shared key.
- A cancelled page that renders holds its renderer until it finishes or reaches its
  deadline, five seconds by default, and its API calls run to completion.
- A pool past its restart budget starts its renderers again after a minute instead of
  staying down until the host restarts.

`capture.ts` now adds the page's cookie to its API calls, as the host does.

## Verification

Run on 2026-10-08 before the fix commit, macOS arm64. The fresh worktree also installed
the packages in `native/bench/auth-spike` and `native/crates/render/bundle/bench` for
TypeScript checking.

| Check                                                                         | Result                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `bun install && bun run i18n:compile`                                         | Passed                                                     |
| `bun run build && bun native/crates/render/bundle/build.ts`                   | Passed                                                     |
| `cargo fmt --all --manifest-path native/Cargo.toml -- --check`                | Passed                                                     |
| Workspace Clippy, all targets, offline, `-D warnings`                         | Passed                                                     |
| Workspace Clippy with `--features bench`, all targets, offline, `-D warnings` | Passed                                                     |
| `snowtime-server` tests, offline                                              | 108 passed, as at `d67ba4c`                                |
| `snowtime-server` tests with `--features bench`, offline                      | 108 passed, as at `d67ba4c`                                |
| `snowtime-host` tests, offline                                                | 18 passed: 17 and the transport test                       |
| `snowtime-host` build with `--features bench`, offline                        | Passed                                                     |
| Every `conformance/*.conformance.ts` through the bench host                   | 49 tests, 528 assertions, 0 failures, as at `d67ba4c`      |
| `compare.ts` through the bench host                                           | 1,381 calls, all byte-equal, as at `d67ba4c`               |
| `hardening-compare.ts` through the bench host                                 | 17 targeted checks passed                                  |
| `bunx tsc --noEmit`                                                           | Passed                                                     |
| `snowtime-render` tests, offline                                              | 18 passed, 1 ignored (the V8 abort); 10 before             |
| `page-compare.ts`, `d67ba4c` bench host against this one                      | 59 pages and requests, all byte-equal                      |
| `cargo audit`                                                                 | None of the three advisories; exits 1 on RUSTSEC-2023-0071 |
| `cargo deny check`                                                            | advisories, bans, licenses, and sources ok                 |

`cargo audit` still fails on `rsa` (RUSTSEC-2023-0071), which only the `auth-spike`
feature brings (L22), as at `d67ba4c`.

To compare pages, build the bench host at `d67ba4c`, keep a copy, and run:

```sh
bun native/bench/page-compare.ts <d67ba4c-binary> native/target/debug/snowtime-axum
```
