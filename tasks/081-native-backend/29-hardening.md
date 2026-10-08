# 081.29: Harden the native backend before the port audit

Status: done

Close the client-address, auth-limit, request-panic, and TypeScript-check gaps left by
[01](01-server-rendering.md#open) and [28](28-auth-port.md#follow-up). Work on
`081-hardening`, from `081-native-poc`, merging `main` first. Stop after these fixes;
review the remaining Open items with Kait before implementing them.

## Acceptance criteria

- [x] Merge `main` and verify the combined port before committing.
- [x] Resolve the TCP peer through `axum_server` connect info in direct mode. Trust
      only the configured `CLIENT_IP_HEADER` in proxy mode. Test persisted session IPs.
- [x] Apply Better Auth's default, special, and custom per-IP rules through
      `tower_governor`, with its 429 body and headers verified against production
      TypeScript. Test keys and GCRA refill windows; prune idle keys periodically.
- [x] Share `RATE_LIMIT` with API per-user writes: on unless development, overridable
      with `on` or `off`, with startup logging and health output.
- [x] Check the whole server crate for request-derived panic paths, fix reachable
      failures to match TypeScript, and record the checked code.
- [x] Fix the native TypeScript errors and pass `tsc --noEmit`.
- [x] Before each commit, pass formatting, workspace Clippy with all targets and
      warnings denied with and without `bench`, server tests in both modes, host
      tests, all HTTP conformance files, and byte comparison. Record counts below.

## Commit separation

Preserve the existing hardening implementation. The TypeScript malformed-passkey fix
is `4b800d0`, a separate commit that applies to main without native files. Its pinned Bun patch
catches only registration-verifier errors; persistence and other internal failures
retain 500. Standalone tests cover malformed attestation, successful registration,
and a forced database insert failure. They also pass against an exported main tree.
Native and shared HTTP coverage match the corrected 400 response in the hardening
commit. Treat encountered input-caused 5xx as bugs; this doesn't require redesigning
hypothetical paths.

The hardening change also corrects the two other input-caused 500s exercised by the
HTTP suites. An organization update with no recognized fields returns 400
`NO_FIELDS_TO_UPDATE`. OAuth start encodes callback URL characters outside Latin-1
before storing the state, so `/雪` redirects to `/%E9%9B%AA` with 302. Existing `/ä`
redirects retain their Latin-1 header. Both backends follow these responses; database
failures retain 500.

## Rate limiter choice

Kait, 2026-10-08: use `governor`'s keyed in-memory GCRA limiter through
`tower_governor`'s Tower layer, applied per route group. In memory suffices for one
native host; TypeScript's Redis store shares counts across instances. Tower's
`RateLimitLayer` limits globally, not by key. Caddy's plugin doesn't serve the default
in-process edge or Better Auth's refusal format. GCRA's smoothing instead of fixed
windows is accepted; the refusal body and header contract must match. Use a custom
extractor that trusts only the configured proxy header, and periodically call
`retain_recent()`. Keep the layer configured by rules without Snowtime policy inside.

## Implemented

Direct listeners read `ConnectInfo<SocketAddr>` in plain, PEM TLS, and ACME modes.
Only an explicitly configured trusted-proxy header overrides that policy. Invalid,
missing, multiple, or chained proxy addresses share a per-path unknown-address bucket;
they cannot create arbitrary text keys. Sessions store Better Auth's normalized address:
IPv4-mapped addresses become IPv4 and IPv6 uses the default `/64` in expanded form.

`governor` 0.10.4 and `tower_governor` 0.8.0 implement the auth limits. The generic
`rate_limit/layer.rs` builds one governor layer per configured route group and keys by
address and concrete path, ignoring query strings and trailing slashes. The app's
`auth/rate_limit.rs` supplies the policy and refusal formatter. Cleanup calls
`retain_recent()` every 60 seconds and ends when the layers are dropped.

The installed Better Auth 1.7.7 sources define these rules:

| Paths relative to `/api/auth`                                                                                                                             | Window seconds | Max |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------: | --: |
| Default                                                                                                                                                   |             10 | 100 |
| Prefixes `/sign-in`, `/sign-up`, `/change-password`, `/change-email`                                                                                      |             10 |   3 |
| `/request-password-reset`, `/send-verification-email`, prefix `/forget-password`, `/email-otp/send-verification-otp`, `/email-otp/request-password-reset` |             60 |   3 |
| `/organization/create` (app custom rule)                                                                                                                  |          3,600 |  10 |
| `/organization/invite-member` (app custom rule)                                                                                                           |             60 |  30 |

Source: `better-auth/dist/api/rate-limiter/index.mjs` and
`better-auth/dist/context/create-context.mjs`, plus the app's `better-auth.server.ts`.
The installed passkey and organization plugins add no limiter rules. The app's
custom storage counts fixed windows; the native layer uses the accepted GCRA smoothing.
The 429 body is `{"message":"Too many requests. Please try again later."}`, with
`Content-Type: application/json` and `X-Retry-After`. The retry value rounds up the
next-token wait, so sign-in's native burst refusal waits 4 seconds instead of the
TypeScript fixed window's 10. The targeted comparison checks identical body bytes,
header names and content type, and each algorithm's expected numeric retry value.
It also checks that governor's default `Retry-After` and `X-Ratelimit-After` are absent.

`RATE_LIMIT=on|off` overrides the default (off only in development). The same boolean
controls the existing fixed-window API per-user writes and invitation count. The host
logs the setting at startup, warns when off, and reports it as `/readyz.rate_limit`.
TLS and ACME remain opt-in.

## Request panic check

Checked the entire `native/crates/server/src` tree, including the optional auth spike:
searched `expect()`, `unwrap()`, scalar indexing, slices, and map indexing, then traced
request values through validation to their use. Test-only panics aren't request paths.

| Checked code                                                                                                                     | Finding and outcome                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP extraction, parameters, JSON/form input, response status and headers                                                        | Path/body errors already become responses. Form JSON serializes `Map<String, Value>` infallibly. Statuses, cookie encodings, and timing headers come from server-controlled formats. Database permits guarantee a reader or writer.                                                                  |
| Common, entry, timer, project, team, settings, and report schemas                                                                | Byte lengths and short-circuit guards protect UUID, ticket, color, and date indexes. Nested objects and report ranges validate before use.                                                                                                                                                           |
| Auth sign-in and invitation acceptance                                                                                           | Replace checked-body deserialization and verified-user assertions with refusals; use safe string extraction after the existing ordered schema checks.                                                                                                                                                |
| OAuth and auth schemas                                                                                                           | Replace request-value and session unwraps with safe extraction or unauthorized responses. Scope arrays and parameter maps retain the same ordered validation. OAuth callback code is checked before exchange; callback URLs now encode characters wider than Latin-1 before storage.                 |
| Passkey registration and dispatch                                                                                                | Bound attestation length, credential-key, COSE, and AAGUID slices. Short or oversized credentials return the corrected TypeScript 400 `FAILED_TO_VERIFY_REGISTRATION` body. Dispatch requires a session without unwraps. Seven malformed attestations have conformance and byte-comparison coverage. |
| Auth writes, cookies, sessions, passkey responses, and spike bridge/store/policy                                                 | JSON values and fixed output structs serialize without input-dependent errors. Cookie delimiter slices follow located ASCII delimiters; token alphabets and generated JSON joins are bounded. Configured URLs and HMAC setup aren't request input.                                                   |
| Calendar, timestamps, holidays, and fill                                                                                         | Day and timestamp parsing bounds byte access. Adjacent-day probes for a valid year-9999 report can exceed Jiff's range: use the boundary offset instead of panicking. The upper ISO report matches TypeScript byte for byte. Holiday records are compiled inputs.                                    |
| Reports and aggregation                                                                                                          | Valid ranges guarantee nonempty buckets; split pieces stay within them. Group indexes follow insertion, totals contain every piece's date, page cuts stay in bounds, and cursor numbers are finite JSON numbers. The second filtered query preserves the first query's row condition.                |
| SQL helpers, scope, availability, migrations, connections, admission, hash lanes, clock, timing, errors, limits, and wire output | Remaining assertions concern typed SQL parameters, static serialization, compiled data, startup configuration, or internal ownership. They aren't failures an HTTP input can trigger.                                                                                                                |

The lower ISO boundary probe exposed an existing parity gap: in Europe/Tallinn,
TypeScript reports year-0000 bounds around years -1904/-1902, while native uses year 0
and formats its negative bound differently. This is separate from the request-panic fix;
its recommendation is below. The byte suite adds the upper-bound regression only.

## TypeScript checks

The shared-props transform now uses Acorn's discriminated node types instead of a
fabricated all-fields AST. The encoding and URL benchmark shims have explicit ambient
declarations for their JS-only modules. `verify-key.ts` needs its isolated, pinned
`auth-spike/package.json` dependencies installed; it passes without a source change or
an upgrade to the app's Better Auth version. The renderer benchmark also needs its
own dependencies installed. `native/README.md` records those setup steps.

## Verification

Initial merge of `main` (`0c176eb`) into the PoC (`26ed262`), 2026-10-08:

- `cargo fmt` and both workspace Clippy modes pass (`--all-targets -D warnings`).
- Server tests: 75 pass without `bench`, 75 with it; host tests: 17 pass.
- Full conformance: 49 tests, 497 assertions, all pass across 10 files. Run each file
  through `native/bench/conformance.ts` on a fresh fixture: auth writes remove members
  that other files need, so one shared fixture isn't a valid full-suite run.
- `compare.ts`: 1,346 calls, all byte-equal, exit 0.

The fresh worktree needs `bun run i18n:compile` before conformance. Local listeners
require execution outside the filesystem sandbox. No Docker, load, or stress runs.

Pre-resume hardening verification, 2026-10-08 (then-uncommitted working tree):

- Formatting and workspace Clippy in both modes pass.
- Server tests: 83 without `bench`, 83 with it; host tests: 17.
- Full conformance: 49 tests and 511 assertions across 10 files, all pass.
- Production auth limits and session-address checks: 17 pass.
- `compare.ts`: 1,361 calls, all byte-equal, exit 0.
- `tsc --noEmit` passes; shared-props tests: 6 tests, 11 assertions.
- Oxlint and Knip pass.

The full run initially exposed a comparison-harness switch mismatch: TypeScript API
write limits apply in development, but native defaults off there. The comparison
harness now explicitly enables native limits and gives independent sign-in validation
cases separate trusted test IPs. TypeScript checking and the full byte comparison
were rerun after those harness changes; the other passing checks preceded them.
Before each future commit, rerun the required checks and record results.

## Remaining Open items

Recommendations only; none implemented in this subtask.

| Item                                                                                      | Recommendation                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01: confirm one-renderer peak RSS against the memory guideline on Linux                   | Defer to a separate Linux measurement task. This work forbids Docker, load, and stress runs.                                                               |
| 01: confirm measurements on the Linux deployment host, including V8/Bun CPU on four pages | Defer until a deployment host is available and those runs are approved. Mac container measurements don't close this item.                                  |
| 01: reduce the 161 MiB warmup peak if the target needs it                                 | Defer until the Linux check establishes a miss. The target is a guideline and bundle minification already reduced the measured peak.                       |
| Discovered: year-0000 report bounds and extended-year timestamp formatting                | Defer to the full parity audit. Decide whether to preserve TypeScript's date-library behavior or correct it on both backends before porting that behavior. |

28's two follow-ups and the input-error corrections are complete. The portable
TypeScript fix is `4b800d0`; the following hardening commit contains native parity,
the preserved implementation, the two other encountered input-error corrections,
and these verification records. Work stops here; the Open recommendations remain
unimplemented.

### Resumed verification before the portable passkey commit

2026-10-08; logs: `/private/tmp/081-resume-first-checks`.

- Formatting, workspace Clippy with all targets and warnings denied in both modes,
  `tsc --noEmit`, Oxlint, and all three Knip configurations pass.
- Server tests: 83 without `bench`, 83 with it; host tests: 17.
- Full HTTP conformance: 49 tests, 511 assertions across 10 fresh fixtures.
- Production auth limits and session-address checks: 17 pass. Retry numbers follow
  each backend's accepted algorithm; the refusal bytes and header contract match.
- Byte comparison: 1,361 calls, all equal, exit 0.
- Shared-props tests: 6 tests, 11 assertions. Portable passkey regressions: 3 tests,
  6 assertions. The regressions also pass against an exported main tree after its
  normal `i18n:compile` setup. The package and lockfile diff applies cleanly to main.

The required native checks ran on the preserved hardening working tree, including its
matching passkey response, before the TypeScript-only commit. Native changes remain
unstaged for the hardening commit. The two other concrete input-caused 500s identified
in the suite are corrected next, with another complete verification run.

### Final hardening verification

2026-10-08; logs: `/private/tmp/081-resume-second-checks`.

- Workspace Clippy with all targets and warnings denied passes in both modes.
  Server tests: 83 without `bench`, 83 with it; host tests: 17.
- Full HTTP conformance: 49 tests, 511 assertions across 10 fresh fixtures.
- Production auth limits and session-address checks: 17 pass.
- Byte comparison: 1,361 calls, all equal, exit 0.
- Rust formatting and Oxfmt on all 18 changed supported files pass.
- Shared-props tests: 6 tests, 11 assertions. TypeScript auth regressions:
  57 tests, 200 assertions across 9 files, including the portable passkey tests.
- `tsc --noEmit`, Oxlint, and all three Knip configurations pass.
- The Unicode callback regression checks the percent-encoded Location, while the
  Latin-1 callback retains its existing header bytes. Empty organization updates
  return 400; malformed passkey registration returns 400 on both backends.

The optional repository-wide Oxfmt check found two pre-existing Markdown formatting
failures in `24-report-reads.md` and `server-rendering/shared-props-mac.md`. Both also
fail on exported committed copies. Those files are unchanged; the required Rust
formatting and formatting of changed files are checked separately.

### Repeat the checks

```sh
cargo fmt --all --manifest-path native/Cargo.toml
cargo clippy --manifest-path native/Cargo.toml --workspace --all-targets --offline -- -D warnings
cargo clippy --manifest-path native/Cargo.toml --workspace --all-targets --features bench --offline -- -D warnings
cargo test --manifest-path native/Cargo.toml -p snowtime-server --offline
cargo test --manifest-path native/Cargo.toml -p snowtime-server --features bench --offline
cargo test --manifest-path native/Cargo.toml -p snowtime-host --offline
cargo build --manifest-path native/Cargo.toml -p snowtime-host --features bench --offline
bunx tsc --noEmit
bun test native/crates/render/bundle/shared-props.test.ts
for file in conformance/*.conformance.ts; do
  bun native/bench/conformance.ts native/target/debug/snowtime-axum "$file" || break
done
bun native/bench/hardening-compare.ts native/target/debug/snowtime-axum
bun native/bench/compare.ts native/target/debug/snowtime-axum
```
