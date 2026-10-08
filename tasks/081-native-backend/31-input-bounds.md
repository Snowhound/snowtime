# 081.31: Bound native auth inputs

Status: done

Fix H1, M5, L16, L17, and L19 from [081.30](30-audit.md). Work on
`081-input-bounds` from `081-audit` at `874022d`, without changing the TypeScript server.

## Acceptance criteria

- [x] Index ordered JSON keys, keeping first position and last value. Extract only
      metadata before writer admission, with a 200,000-key regression.
- [x] Sweep expired verification rows on passkey and OAuth lookup. Bound OAuth
      `additionalData` to 4 KiB and preserve Better Auth's refusal shape.
- [x] Count password length in UTF-16 units. Bound scope issues and stored auth values.
- [x] Check OAuth token expiry multiplication and addition.
- [x] Pass the required build, Rust, conformance, comparison, and TypeScript checks.
      Record counts and rerun the ordered JSON and verification probes.

## Parity record

Better Auth 1.7.7 and the unchanged TypeScript server remain the behavior reference.
Native refusals use HTTP 400 with `{"message":"…","code":"VALIDATION_ERROR"}`.
Bounds apply after ordinary schema checks and before writer admission. Provider images
are checked before user or account writes in the OAuth callback.

Deliberate differences from TypeScript:

| Input                                                  | Native bound                                                                               | TypeScript behavior                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| OAuth `additionalData`                                 | 4,096 bytes of compact JSON, including keys and escaping                                   | No bound in `api/routes/sign-in.mjs` or `oauth2/state.mjs`                                                                          |
| Organization metadata, create and update               | 4,096 bytes of compact JSON                                                                | Unbounded record in `plugins/organization/routes/crud-org.mjs`                                                                      |
| Profile image, OAuth provider image, organization logo | 2,048 UTF-8 bytes; oversized input refuses before persistence                              | No length bound in `api/routes/update-user.mjs`, provider profiles, or organization routes                                          |
| Passkey registration name                              | 100 UTF-16 units after JavaScript whitespace trimming                                      | `@better-auth/passkey/dist/index.mjs` trims but has no maximum                                                                      |
| Session user agent                                     | Truncate to at most 512 UTF-8 bytes at a character boundary                                | Stores the supplied header without a length bound                                                                                   |
| Invalid OAuth scopes                                   | At most 32 scope issues, with their original index and message                             | Emits an issue for every invalid element                                                                                            |
| Passkey verification cleanup                           | Sweep all expired verification rows after lookup, including a missing challenge identifier | 1.7.7's `consumeVerificationValue` deletes only the consumed identifier; the requested global sweep follows `findVerificationValue` |

OAuth cleanup matches `internal-adapter.mjs`'s `findVerificationValue`: select first,
then delete rows with `expires_at < now`, including on a missing identifier. Selecting
first preserves the requested expired state's error URL and cookie behavior. Challenge
creation alone doesn't sweep; unused rows remain until a lookup. This closes M5's
missing cleanup on lookup, without adding a periodic sweeper.

Ordered metadata retains JavaScript integer-key order, first position and last value
for duplicate keys, including duplicate `data` and `metadata` fields. Unknown fields
use Serde's ignored-value visitor. Only the selected metadata becomes `OrderedJson`.
The password bound now matches Better Auth's `utils/password.mjs` JavaScript length.
An unrepresentable OAuth expiry becomes absent rather than overflowing; ordinary,
zero, and negative values retain their existing behavior.

## Verification

2026-10-08, macOS arm64. Full logs are in `/private/tmp/081-input-bounds-checks`.

- `bun install`, `i18n:compile`, frontend build, and render bundle build pass.
  The two isolated benchmark packages are installed with their frozen lockfiles.
- `cargo fmt --check` and workspace Clippy with all targets and warnings denied pass,
  both without and with `bench`.
- Server tests: 100 pass without `bench`, 100 with it (83 at the audit baseline).
  Host tests: 17 pass. The host builds with `bench` for fake-provider OAuth checks.
  The complete server suite, including the 200,000-key regression, takes under a second.
- All 10 HTTP conformance files pass on separate fixtures: 49 tests, 522 assertions
  (baseline: 49 tests, 511 assertions). The 11 added assertions cover metadata ordering,
  ignored fields, storage boundaries, scope refusals, and zero/negative token expiries.
- Byte comparison: 1,375 calls, all byte-equal, exit 0 (baseline: 1,361).
  The 14 added cases include a callback proving that another lookup swept an unrelated
  expired OAuth state. The preceding run without that case passes 1,374 calls.
  Added cases retain exact metadata order and duplicates, valid storage boundaries,
  32 scope issues, 64/65
  astral passwords, and zero/negative token expiries. The imported-passkey fixture
  compares a 512-byte user agent. Oversized values deliberately differ and have native
  endpoint tests; they aren't masked or counted as byte-equal refusals.
- `tsc --noEmit`, changed-file Oxlint and Oxfmt, and all three Knip configurations
  pass. The TypeScript server under `src/` is unchanged.

The first host-test attempt inside the sandbox couldn't bind its local TLS listeners.
All 17 pass when rerun outside the sandbox. HTTP suites and probes also run outside it.

### Audit probes

Run `bun native/bench/audit/probe.ts native/target/debug/snowtime-axum orderedjson verification`.

| Ordered JSON request      | Audit baseline             | After fixes                   |
| ------------------------- | -------------------------- | ----------------------------- |
| 10,000 keys, 108 KiB      | 425 ms                     | 200 in 12 ms                  |
| 25,000 keys, 269 KiB      | 2,372 ms                   | 200 in 28 ms                  |
| 50,000 keys, 537 KiB      | 9,957 ms                   | 200 in 53 ms                  |
| 100,000 keys, 1,074 KiB   | 408 after 30,005 ms        | 200 in 107 ms                 |
| Concurrent settings write | 503 after admission expiry | 200 in 3 ms, no `Retry-After` |

The concurrent probe uses valid `weekStart: "mon"` and starts after 10 ms so it overlaps
with the now-short update; the original used invalid `1` after 300 ms.

Fifty unauthenticated challenge requests still create 50 rows. The 1.5 MB
`additionalData` request now returns 400 and stores no row; the largest existing
challenge row is 112 bytes, versus the audit's 1,500,249-byte OAuth row. An hour later,
challenge generation alone leaves the 50 expired rows. A passkey lookup deletes them
and consumes its new challenge, leaving zero rows (401 from the invalid assertion).
An OAuth lookup for a missing state deletes an independently inserted expired row and
returns 302, leaving zero rows. Neither probe adds a periodic sweep.

No Docker, load, or stress runs. No push, rebase, or merge.
