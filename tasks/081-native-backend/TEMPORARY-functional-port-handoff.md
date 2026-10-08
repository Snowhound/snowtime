# Temporary handoff: functional port

**Temporary: remove this file after the invitation-limit decision is resolved and the
full comparison passes.**

2026-10-08. Branch: `081-functional-port`. Kait authorized pushing partial work with a
temporary handoff if blocked. Main is unchanged. Steps 1–4 are committed and verified;
step 5 is implemented but has one unresolved comparison failure.

## Pending decision

Kait was asked whether to preserve Better Auth's current limit behavior or fix
TypeScript to count all live pending invitations. No answer has arrived. Do not treat
elapsed time as approval to change TypeScript.

`native/bench/compare.ts` creates a fresh fixture with at least 100 live pending
invitations and expired pending rows. Owner creation returns:

- TypeScript: HTTP 200, another invitation.
- Native: HTTP 403, `INVITATION_LIMIT_REACHED`, "Invitation limit reached".

Better Auth 1.7.6's `plugins/organization/adapter.mjs` calls `findMany` without a limit
in `findPendingInvitations`, then filters expiry in JavaScript. Core's
`db/adapter/factory.mjs` defaults `findMany` to 100 rows. Expired rows in that set reduce
its count, so it can admit an invitation despite 100 live pending ones elsewhere.
Native currently counts all live pending rows in SQL.

The comparison intentionally keeps the failure visible. It reports 877 byte-equal
calls, then this mismatch and a nonzero exit. The two final limit cases aren't reached.

## What passed

- fmt; workspace Clippy with and without `bench`, all targets, warnings denied.
- 63 server tests per configuration; 15 host tests.
- 19 projects/teams/settings/session conformance tests, 61 assertions.
- 4 invitation conformance tests, 8 assertions. Only invitation acceptance is filtered
  out; acceptance isn't part of task 081.26's scope.
- 26 TypeScript invitation/team/schema tests, 77 assertions.
- Chrome project and team lifecycle flows, reload persistence, empty console/errors.

Saved outputs and line counts are in
[functional-port/step5](functional-port/step5/). Task 081.26 records each earlier step.
The empty project PATCH fix was explicitly approved by Kait and is committed in both
servers, with a regression test and an architecture note.

## Finish and remove this file

1. Get Kait's decision. Preserve TypeScript's behavior in native, or implement the
   authorized TypeScript limit fix in the auth domain with regression coverage and
   an architecture note. Keep role, duplicate, and existing-member refusal order.
2. Rerun fmt, workspace Clippy and server tests with and without `bench`, host tests,
   domain conformance, and every comparison call. Record all counts in task 081.26.
3. Update task status, the native README, and subtask 01. Remove this file and push
   the branch. No merge or rebase is authorized.

## Local review

The seeded review servers are running in Ubuntu WSL:

- TypeScript: <http://localhost:3100/sign-in>.
- Native: <http://127.0.0.1:3200/sign-in>.
- Lumen owner: `kristiina@lumen.example.com`; password: `snowtime-local`.

Both use plain HTTP, separate databases, and separate cookie hostnames. The native
host is a debug build. Source/build artifacts are in `/root/snowtime-functional-port`;
the tested host is `/root/snowtime/native/target/debug/snowtime-axum`.
[Task 081.26's local review](26-functional-port.md#local-review) gives seed and startup
commands for a new session. These paths are machine-local, not part of the pushed branch.

The native host reads inherited environment variables only. It doesn't load dotenv
files or parse CLI configuration; dotenv loading is recorded as a possible future option.
Passkey endpoints, Google/OAuth, and native Windows builds remain follow-ups.
