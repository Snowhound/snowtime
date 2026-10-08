# 081.29: Harden the native backend before the port audit

Status: in-progress

Close the client-address, auth-limit, request-panic, and TypeScript-check gaps left by
[01](01-server-rendering.md#open) and [28](28-auth-port.md#follow-up). Work on
`081-hardening`, from `081-native-poc`, merging `main` first. Stop after these fixes;
review the remaining Open items with Kait before implementing them.

## Acceptance criteria

- [x] Merge `main` and verify the combined port before committing.
- [ ] Resolve the TCP peer through `axum_server` connect info in direct mode. Trust
      only the configured `CLIENT_IP_HEADER` in proxy mode. Test persisted session IPs.
- [ ] Apply Better Auth's default, special, and custom per-IP rules through
      `tower_governor`, with its 429 body and headers verified against production
      TypeScript. Test keys and GCRA refill windows; prune idle keys periodically.
- [ ] Share `RATE_LIMIT` with API per-user writes: on unless development, overridable
      with `on` or `off`, with startup logging and health output.
- [ ] Check the whole server crate for request-derived panic paths, fix reachable
      failures to match TypeScript, and record the checked code.
- [ ] Fix the native TypeScript errors and pass `tsc --noEmit`.
- [ ] Before each commit, pass formatting, workspace Clippy with all targets and
      warnings denied with and without `bench`, server tests in both modes, host
      tests, all HTTP conformance files, and byte comparison. Record counts below.

## Rate limiter choice

Kait, 2026-10-08: use `governor`'s keyed in-memory GCRA limiter through
`tower_governor`'s Tower layer, applied per route group. In memory suffices for one
native host; TypeScript's Redis store shares counts across instances. Tower's
`RateLimitLayer` limits globally, not by key. Caddy's plugin doesn't serve the default
in-process edge or Better Auth's refusal format. GCRA's smoothing instead of fixed
windows is accepted; the refusal body and header contract must match. Use a custom
extractor that trusts only the configured proxy header, and periodically call
`retain_recent()`. Keep the layer configured by rules without Snowtime policy inside.

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

## Remaining Open items

Pending recommendations; no work authorized on these in this subtask.
