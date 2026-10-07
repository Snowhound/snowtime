# 081.26: Port the remaining functional calls

Status: in-progress (steps 1–2 done; waiting for Kait's localhost review)

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

- [ ] Create, update, archive, unarchive, delete, and project-team PUT and DELETE
      routes preserve the TypeScript role rules and validation
- [ ] Project conformance passes; comparison covers valid and malformed input,
      member refusals, and every owner/member difference

### 4. Team writes

- [ ] Create, update, delete, and member PUT, PATCH, and DELETE routes preserve the
      TypeScript role rules and validation
- [ ] Team conformance passes; comparison covers valid and malformed input,
      member refusals, and every owner/member difference

### 5. Invitations and issue links

- [ ] `GET /invitations/:id`, `GET /invitations`, `POST /invitations`, and
      `PATCH /issue-links` preserve the TypeScript role rules and validation
- [ ] Invitation conformance passes; comparison covers valid and malformed input,
      member refusals, and every owner/member difference

### Each step

- [ ] Each route lives in its domain's `routes.rs`, with a handler that calls its rule
- [ ] Ordered schema validation matches Valibot's messages before deserialization
- [ ] Each write comparison uses fresh state or an ordered sequence that leaves both
      servers in the same state; every comparison call is byte-equal
- [ ] Before each implementation commit, run `cargo fmt`, workspace Clippy with
      `--all-targets -- -D warnings` with and without `--features bench`, server tests
      with and without `bench`, host tests, domain conformance, and `compare.ts`;
      record counts and saved output here
- [ ] Add handler rows to `native/bench/lines.ts`; record counts and new porting
      patterns for subtask 05
- [ ] Update `native/README.md`'s ported/unported list and subtask 01's notes

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
No TypeScript server behavior changed. No Docker, load runs, stress runs, or native
Windows builds were used. Steps 3–5 wait for Kait's review.

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
bun run db:migrate
bun run db:seed --company
cp functional-review-ts.db functional-review-native.db
HOST=127.0.0.1 PORT=3100 bun .output/server/index.mjs
```

In a second Ubuntu terminal, start the native host:

```sh
cd /root/snowtime-functional-port
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
