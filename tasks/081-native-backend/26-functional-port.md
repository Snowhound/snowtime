# 081.26: Port the remaining functional calls

Status: in-progress

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

- [ ] `PUT /settings` and `PATCH /settings` preserve the TypeScript rules, validation
      order, messages, and absent, null, and present field behavior
- [ ] Settings conformance passes; comparison covers valid and malformed input,
      owner and member writes, signed-out refusals, and unchanged state after refusal
- [ ] Stop after this step and give Kait the commit range, verification counts, and
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

## Follow-ups

- Google/OAuth sign-in parity
- Native Windows builds and verification
