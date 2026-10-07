# 081.26: Port the remaining functional calls

Status: todo

Port the sign-in page and settings writes first, then project and team writes,
invitations, and issue links. Follow subtask 24's route, schema, comparison, and
verification pattern. The TypeScript server remains the source of truth.

## Acceptance criteria

### 1. Sign-in reads and sign-out

- [ ] Native routes serve `/sign-in-methods`, `/deployment`, and `/dev-users`, with
      the same availability and response bytes as the TypeScript server
- [ ] Better Auth sign-out deletes the session and sends matching cookie headers;
      the signed-out `/sign-in` page renders, and password sign-in and sign-out work
- [ ] Session conformance passes; comparison covers valid and malformed requests,
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

## Verification

Not run. The first commit records the task only. Implementation results belong here
after each step, with the commit range and commands to reproduce them.

## Follow-ups

- Google/OAuth sign-in parity
- Native Windows builds and verification
