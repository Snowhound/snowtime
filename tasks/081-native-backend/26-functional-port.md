# 081.26: Port the remaining functional calls

Status: done

Port the sign-in page and settings writes first, then project and team writes,
invitations, and issue links. Follow subtask 24's route, schema, comparison, and
verification pattern. The TypeScript server remains the source of truth.

## Acceptance criteria

### 1. Sign-in reads and sign-out

- [x] Native routes serve `/sign-in-methods`, `/deployment`, and `/dev-users`, with
      the same availability and response bytes as the TypeScript server
- [x] Better Auth sign-out deletes the session and sends matching cookie headers;
      the signed-out `/sign-in` page renders, and password sign-in and sign-out work
- [x] Session conformance for the ported calls passes; comparison covers valid and malformed requests,
      signed-out callers, owner and member sessions, and origin refusals

### 2. Settings writes

- [x] `PUT /settings` and `PATCH /settings` preserve the TypeScript rules, validation
      order, messages, and absent, null, and present field behavior
- [x] Settings conformance passes; comparison covers valid and malformed input,
      owner and member writes, signed-out refusals, and unchanged state after refusal
- [x] Stop after this step and give Kait the commit range, verification counts, and
      commands to run both apps on localhost with separate seeded database copies

### 3. Project writes

- [x] Create, update, archive, unarchive, delete, and project-team PUT and DELETE
      routes preserve the TypeScript role rules and validation
- [x] Project conformance passes; comparison covers valid and malformed input,
      member refusals, and every owner/member difference

### 4. Team writes

- [x] Create, update, delete, and member PUT, PATCH, and DELETE routes preserve the
      TypeScript role rules and validation
- [x] Team conformance passes; comparison covers valid and malformed input,
      member refusals, and every owner/member difference

### 5. Invitations and issue links

- [x] `GET /invitations/:id`, `GET /invitations`, `POST /invitations`, and
      `PATCH /issue-links` preserve the TypeScript role rules and validation
- [x] Invitation conformance passes; comparison covers valid and malformed input,
      member refusals, and every owner/member difference

### Each step

- [x] Each route lives in its domain's `routes.rs`, with a handler that calls its rule
- [x] Ordered schema validation matches Valibot's messages before deserialization
- [x] Each write comparison uses fresh state or an ordered sequence that leaves both
      servers in the same state; every comparison call is byte-equal
- [x] Before each implementation commit, run `cargo fmt`, workspace Clippy with
      `--all-targets -- -D warnings` with and without `--features bench`, server tests
      with and without `bench`, host tests, domain conformance, and `compare.ts`;
      record counts and saved output here
- [x] Add handler rows to `native/bench/lines.ts`; record counts and new porting
      patterns for subtask 05
- [x] Update `native/README.md`'s ported/unported list and subtask 01's notes

## Porting notes

Read each TypeScript domain before porting it. Preserve its behavior; ask Kait if a
rule appears wrong. A determinism fix can change TypeScript behavior only with a
recorded architecture decision, as subtask 24's explicit `en-US` collation does.

No Docker, load runs, or stress runs. Work on a separate branch; don't push, rebase,
or merge without Kait's approval.

Patterns for subtask 05:

- Public reads that use environment configuration run through `Public::with_config`.
  The rule receives the configuration and a read connection, without a session check.
  Provider ids keep TypeScript's display order; demo mode hides them. Seeded names
  come from the source roster, with company users included only if their email exists.
- Better Auth's sign-out uses its own Zod schema and refusal format. JSON parsing
  precedes origin checks, callback checks precede schema validation, and the write
  runs on the writer lane. An absent body is valid.
- A response can send several `Set-Cookie` headers. Sign-out expires the signed token,
  cookie cache, canonical numbered cache chunks, and remember-me flag in Better Auth's
  order. An incoming base cache cookie receives a second expiry header.
- Compare writes in the same order on independent database copies. Give sign-out both
  servers the same cache-cookie fields. Replay only the signed token to check deletion:
  TypeScript's copied cookie cache can still pass its five-minute cache check.
- The conformance harness accepts `CONFORMANCE_TEST_NAME_PATTERN` for a partial port.
  Step 1 filters the language-write test until step 2, and issue-links tests until step 5.
- Handler line counting ignores quoted strings when balancing brackets, so a URL or
  `"//"` in a rule cannot hide the rest of its declaration as a comment.
- Settings string checks run in field order before deserialization, including the
  zone's pattern and lookup. ICU rejects tzdb's `Factory` placeholder, which jiff accepts;
  the settings validator rejects it explicitly and preserves accepted aliases.
- The shared TypeScript wire decoder revives `"true"` and `"false"` for booleans in
  JSON bodies too. Optional Rust booleans use the same revival before deserialization;
  explicit null still fails a nonnullable field.
- `Assignments::set_optional` omits absent nonnullable fields. Nullable fields use
  `Patch` to distinguish absent from null. Collection selection inserts a null pin
  when the patch omits it. A pin check uses the saved collection before applying writes.
  An empty patch reads without updating audit columns. Writes set the actor explicitly.

## Verification

### Step 5

Verified on Ubuntu x64 in WSL on 2026-10-08. Kait approved fixing TypeScript's invitation
limit to count all live pending rows. Both servers now enforce it. The earlier partial
commit recorded 877 equal calls and one limit mismatch; Kait authorized that partial push.
The temporary handoff is removed after the completed verification below.

- `cargo fmt` and both workspace Clippy configurations pass.
- Server tests: 63 pass without `bench`, and 63 with it. Host tests: 15 pass.
- Projects, teams, settings, and session conformance: 19 pass, 61 assertions.
- Invitation conformance: 4 pass, 8 assertions, 1 acceptance test filtered out. The
  original combined Better Auth refusal test is split without changing its assertions,
  so creation runs independently of acceptance, which is outside this task's scope.
- TypeScript invitation, team-invitation, auth-schema, and team tests: 27 pass,
  81 assertions. The regression covers expired rows ahead of live ones, the final slot,
  refusal at the cap, and earlier duplicate and existing-member refusals.
- Comparison: all 880 calls byte-equal, including project, team, and invitation limits,
  invitation previews in all states, creation and role refusals, the invitation rate
  limit, and issue-link writes. The saved command exits zero.
- Chrome creates, edits, assigns, archives, restores, and deletes a temporary project.
  It creates and renames a temporary team, adds a member, promotes them to lead,
  verifies the role after reload, removes them, and deletes the team. Console and
  error checks are empty. These review rows are removed afterward.

Patterns for subtask 05:

- Auth-backed application rules use `InOrganization::with_auth` to receive config and
  the rate store after the ordinary session, scope, and schema checks. The invite's
  30-per-minute count runs before its admin refusal, as TypeScript does.
- Better Auth refusals retain their status, code, message, and field order in the
  application API. Invitation validation applies Valibot's email check before Zod's.
- Public invitation previews serialize each state in TypeScript's field order and
  omit closed or expired private fields. Listing pending invitations needs membership,
  but doesn't require an admin role.
- Generated invitation IDs use the same explicit pairing as team IDs. `expiresAt`
  is another advancing-clock field, masked in creation and subsequent list comparisons.
- Shared trimming uses JavaScript's whitespace set, including BOM and excluding U+0085.
  Nullable required IDs distinguish a missing key from explicit null.
- Better Auth's invitation-limit callback counts all live pending rows in SQL and retains
  the plugin's refusal status and code. It runs at the existing limit check, preserving
  earlier refusals. The approved correction is recorded in `docs/architecture/auth.md`.
- Both comparison servers request a free port. Native's earlier random port could collide
  with another comparison server and send calls to its database and rate-limit state.

Saved outputs are in [functional-port/step5](functional-port/step5/).

| Handler or helper                                     | TypeScript | Rust |
| ----------------------------------------------------- | ---------: | ---: |
| `invitationPreview`                                   |         40 |   15 |
| `listInvitations`                                     |         16 |    4 |
| `inviteMember` API wrapper / native full rule         |         19 |  129 |
| App invitation wrapper (included in native full rule) |         26 |    0 |
| Invitation-limit callback (included in native rule)   |         20 |    0 |
| `updateIssueLinks`                                    |          9 |   24 |

The TypeScript invitation wrapper counts exclude Better Auth's installed
`plugins/organization/routes/crud-invites.mjs` endpoint. The native full rule includes
the endpoint's relevant permission, existing-member, pending-invitation, and limit checks.

### Step 4

Verified on Ubuntu x64 in WSL on 2026-10-08:

- `cargo fmt` and both workspace Clippy configurations pass.
- Server tests: 59 pass without `bench`, and 59 with it. Host tests: 15 pass.
- Project and team conformance: 8 pass, 34 assertions (4 tests per domain).
- All 754 comparison calls are byte-equal. Team cases include organization admins,
  owners, members, and signed-out callers. Membership writes and member counts run
  in transactions. Unit tests check repeat PUT preserves a lead's role and increments
  the count once, repeat DELETE refuses without decrementing again, the team limit,
  and deleting the last team with cascading membership removal.
- Generated team IDs are checked as UUIDv7, paired under an explicit alias, and reused
  through later requests. Only those paired generated IDs are normalized in answers;
  supplied IDs stay exact. Every domain sequence still uses independent fresh copies.
- Names share ordered validation for trimming, required text, and UTF-16 length.

Saved outputs are in [functional-port/step4](functional-port/step4/).

| Handler or helper  | TypeScript | Rust |
| ------------------ | ---------: | ---: |
| Team write helpers |         31 |   53 |
| `createTeam`       |         25 |   32 |
| `renameTeam`       |         14 |   23 |
| `deleteTeam`       |          9 |   13 |
| `addTeamMember`    |         17 |   23 |
| `removeTeamMember` |         16 |   28 |
| `setTeamRole`      |         11 |   26 |

### Step 3

Verified on Ubuntu x64 in WSL on 2026-10-08:

- `cargo fmt` and workspace Clippy with `--all-targets -- -D warnings` pass, with
  and without `bench`.
- Server tests: 56 pass without `bench`, and 56 with it. Host tests: 15 pass.
- Projects conformance: 4 pass, 18 assertions. TypeScript project tests: 22 pass,
  66 assertions. All 692 comparison calls are byte-equal.
- Each domain write sequence starts new hosts on independent fixture copies, so it
  doesn't inherit settings writes or their rate counters. The harness also checks
  expected statuses, so matching rate-limit refusals cannot hide an intended success.
- Archive comparisons mask `archivedAt`, another value of each server's advancing
  clock. Repeated-archive stability is checked directly in Rust and conformance.
- Empty project PATCH originally raised Drizzle's "No values to set" and HTTP 500.
  Kait authorized a successful no-op in both servers on 2026-10-08. Both check admin
  access and existence first, then return the existing project without audit changes.
  The TypeScript regression test and `docs/architecture/data.md` record this fix.
- Project deletion uses a transaction for the entry check, assignment removal, and
  logical delete. A refusal rolls back the assignment removal. Audit actors stay explicit.
- The native README records environment-only configuration and dotenv loading as a
  possible future option. Passkey endpoints remain unported despite the method list.

Saved outputs are in [functional-port/step3](functional-port/step3/).

| Handler or helper                         | TypeScript | Rust |
| ----------------------------------------- | ---------: | ---: |
| Project write helpers                     |         20 |   40 |
| `createProject`                           |         28 |   44 |
| `updateProject`                           |         19 |   37 |
| `archiveProject`, including `setArchived` |         15 |   26 |
| `unarchiveProject`                        |          3 |    3 |
| `deleteProject`                           |         35 |   51 |
| `assignProjectToTeam`                     |         16 |   22 |
| `unassignProjectFromTeam`                 |         17 |   19 |

The first commit, `5c09da23`, records the task only. Step 1 runs on Ubuntu x64 in WSL
on 2026-10-07, using a debug host binary and separate fixed-clock seeded copies.

- `cargo fmt --all --manifest-path native/Cargo.toml` passes.
- Workspace Clippy with `--all-targets -- -D warnings` passes with and without `bench`.
- Server tests: 48 pass without `bench`, and 48 with it. Host tests: 15 pass.
- Frontend build and `bun native/crates/render/bundle/build.ts` pass.
- Session conformance: 4 pass, 3 filtered out, 11 assertions. The filter is
  `signed out, the session is null|signed in, it has the user|signed-out reads`.
- Comparison: all 384 calls byte-equal, including sign-out cookie headers. Environment
  cases cover production, demo, all three configured providers, and normalized domains.
  Only subtask 24's existing clock, sign-in time, and URL masks apply.
- Chrome renders the signed-out page, signs the Lumen Works owner in through the
  seeded-user button, and signs out through the account menu. Browser console and
  error checks are empty. The review uses isolated seeded hosts, not the dev server.

Saved outputs are in [functional-port/step1](functional-port/step1/).

### Step 2

Verified on Ubuntu x64 in WSL on 2026-10-07:

- `cargo fmt` and workspace Clippy with `--all-targets -- -D warnings` pass, with
  and without `bench`.
- Server tests: 53 pass without `bench`, and 53 with it. Host tests: 15 pass.
- Settings conformance: 4 pass, 8 assertions. Session conformance: 5 pass,
  2 filtered out, 14 assertions. The filter `^(the session|signed-out reads)` excludes
  only the issue-links tests that belong to step 5.
- Comparison: all 624 calls byte-equal. Every settings field has valid and malformed
  cases as owner and member. Ordered writes use separate database copies. Noah's settings
  row is absent from the private fixture before either server starts, so first creation,
  missing-row patches, defaults, and idempotency are compared too.
- TypeScript settings tests: 13 pass, 66 assertions. Changed-file lint and commit hooks,
  including Knip, pass.
- Chrome changes week start to Sunday and theme to Dark, sees Saved, and keeps both
  after a full native page reload. Browser console and error checks are empty.
  The isolated review hosts and browser sessions are stopped.

Saved outputs are in [functional-port/step2](functional-port/step2/).
Steps 1–2 changed no TypeScript server behavior. No Docker, load runs, stress runs, or
native Windows builds were used. Kait reviewed these steps and resumed on 2026-10-08.

## Line counts

`bun native/bench/lines.ts` counts nonblank, noncomment lines in the named declarations.
Routes and tests are outside these counts; validation and URL checks have separate rows.
Sign-out's TypeScript source is Better Auth 1.7.6's installed endpoint.

| Handler or helper                                 | TypeScript | Rust |
| ------------------------------------------------- | ---------: | ---: |
| `signInMethods`, including provider configuration |         37 |   12 |
| `getDeployment`                                   |          3 |    6 |
| `getDevUsers`, including the Rust source roster   |         13 |   40 |
| `signOut`                                         |         80 |   77 |
| Sign-out body validation                          |          5 |   40 |
| Sign-out URL checks                               |         28 |   90 |
| `createSettings`                                  |          9 |   12 |
| `updateSettings`                                  |         24 |   64 |

## Local review

The Linux verification copy is `/root/snowtime-functional-port` in Ubuntu WSL. Its
frontend and renderer bundles are built, and the host binary is
`/root/snowtime/native/target/debug/snowtime-axum`. From PowerShell, enter Ubuntu with
`wsl -d Ubuntu`. For another Linux or macOS checkout, build the frontend and renderer
as [native/README.md](../../native/README.md#server-rendering) describes, then build the host.

Create the two review databases while both apps are stopped. These commands use new
review files; keep them separate from any database you already use:

```sh
cd /root/snowtime-functional-port
export PATH=/root/.bun/bin:/root/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export NODE_ENV=development
export BETTER_AUTH_SECRET=localhost-review-secret-081-functional-port
export BETTER_AUTH_URL=http://localhost:3100
export TURSO_DATABASE_URL=file:functional-review-ts.db
unset ACME_DOMAINS ACME_EMAIL TLS_CERT_FILE TLS_KEY_FILE HTTP_REDIRECT_PORT
bun --no-env-file scripts/db-migrate.ts
bun --no-env-file scripts/db-seed.ts --company
cp functional-review-ts.db functional-review-native.db
HOST=127.0.0.1 PORT=3100 bun --no-env-file .output/server/index.mjs
```

In a second Ubuntu terminal, start the native host:

```sh
cd /root/snowtime-functional-port
unset ACME_DOMAINS ACME_EMAIL TLS_CERT_FILE TLS_KEY_FILE HTTP_REDIRECT_PORT
NODE_ENV=development HOST=127.0.0.1 PORT=3200 RENDERERS=1 \
  BETTER_AUTH_SECRET=localhost-review-secret-081-functional-port \
  BETTER_AUTH_URL=http://127.0.0.1:3200 \
  TURSO_DATABASE_URL=file:functional-review-native.db \
  EDGE_STATIC_DIR=native/crates/render/bundle/dist/public \
  /root/snowtime/native/target/debug/snowtime-axum
```

Open TypeScript at <http://localhost:3100/sign-in> and native at
<http://127.0.0.1:3200/sign-in>. The different hostnames keep their login cookies separate.
Use a listed seeded account, or `owner@example.com` with password `snowtime-local`.
`kristiina@lumen.example.com` is the Lumen Works owner. Settings > Preferences saves at
once; reload to check persistence, then sign out through the account menu.

## Follow-ups

- Google/OAuth sign-in parity
- Native Windows builds and verification
