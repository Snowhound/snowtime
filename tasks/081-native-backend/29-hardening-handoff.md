# Task 081.29 verification handoff

Completed on 2026-10-08. Work stops after the verified hardening commit.

## Working state

- Worktree: `/private/tmp/snowtime-081-hardening`. Branch: `081-hardening`.
- Base: `081-native-poc` at `26ed262`. Main `0c176eb` was merged in `3599412`.
- Portable TypeScript passkey fix: `4b800d0`. Its pinned dependency patch returns 400
  for malformed registration verification and preserves 500 for database failures.
  The standalone regressions also pass on an exported main tree.
- The following hardening commit preserves the original implementation and records
  both full verification runs. Native matches the passkey 400. The hardening change also fixes the two other concrete
  input-caused 500s exercised by the suites: empty organization updates and Unicode
  callback URLs. See [task 29](29-hardening.md) for behavior, counts, and the Open list.
- The main and PoC checkouts are unchanged. The dependency symlink was replaced with a
  local clone before applying the Bun patch; shared dependencies weren't edited.
- No push, rebase, further merge, Docker, load, or stress runs.

## Verification

All required checks passed before each commit. Logs are in
`/private/tmp/081-resume-first-checks`. Final hardening logs are in
`/private/tmp/081-resume-second-checks`. Task 29 records counts and check scope.
Pre-commit lint, formatting, and Knip run on each commit.

## Stop point

The verified hardening change is the stop point. Present the remaining Open
recommendations from task 29 before implementing any of them: Linux memory and CPU
measurements, conditional warmup reduction, and year-0000 report parity.
