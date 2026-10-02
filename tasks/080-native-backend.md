# 080: Native backend

Status: todo (waits on task 078's baseline; builds on task 079)

A second backend for self-hosting that serves many companies on a fraction of today's
memory and CPU, without a garbage collector. The TypeScript backend stays the source of
truth and keeps the Vercel deployment. An AI session generates the native port from a
given commit of it. One frontend source works with both. Changes to the TypeScript app are
welcome where they make this task much simpler. The native server renders no HTML: task
079's route shells leave it the API alone. This task researches the decisions and proves
the gain on the hot path; full parity is a later task.

## Targets

- Linux on one core, with resident memory under 64 MB, aiming at 32 MB, at task 078's
  peak load on the L dataset, SQLite's own cache included. The domain code makes no OS
  calls outside a thin layer, so a port to a microcontroller without an OS stays possible
  later.
- No garbage collector, an arena per request, no allocation per row on hot paths, and
  indexed arrays where the data allows.
- The same SQLite schema and migrations as the TypeScript backend, so a self-hoster can
  switch either way on one file. Turso's engine comes later.
- One process with Caddy in front for TLS, static files, and the route shells. Folding the
  proxy into the binary comes later.

## Questions to answer

Each answer comes with measurements. A design that adds complexity for a small gain is
rejected, as in task 069.

1. Where today's CPU and memory go, from task 078: server rendering, Better Auth, Drizzle,
   the JS heap. This sets how much better the native backend must be to justify two
   backends.
2. The contract both backends implement. It starts from the public `/api/v1` that issue
   #2 settled on 2026-10-01: JSON, documented in `docs/api.md`. The working assumption is
   JSON throughout, defined in one schema that generates the types and the validation for
   both backends. Protobuf decoding checks only wire types, so lengths, formats, ranges,
   and required fields still need validation in any format, and a 200-byte request parses
   in about a microsecond either way. The format matters for the large responses: report
   entries, the export, and the year timesheet. For those, try columns instead of rows
   (one array per field, repeated strings as indexes into a table), first as JSON and then,
   if measured worth it, as typed arrays over the response's `ArrayBuffer`, which the
   browser reads without parsing. Compare against Protobuf with ConnectRPC on decode time
   in the browser, compressed bytes, bundle size, and code generation for both languages.
3. The frontend adapter. The data layer calls the contract; Start serves it on Vercel and
   the native server self-hosted.
4. A mechanical port. What the TypeScript side must keep for that (rules that take
   `(db, scope, input)`, SQL both sides share, the contract), and a conformance suite of
   HTTP-level tests on seeded databases that both backends pass. A port is complete when
   the suite passes.
5. Auth through [better-auth-rs](https://github.com/better-auth-rs/better-auth-rs) (MIT or
   Apache-2.0). It targets `better-auth@1.7.6`, the version this app uses, and tests its
   routes, payloads, and cookies against the TypeScript server with the real
   `better-auth/client`, so the frontend's auth calls could stay unchanged. API keys with
   permissions, which issue #2 chose for `/api/v1`, and device authorization, which Kait
   expects to add beside them, are both in its v1 scope.

   Checked on 2026-10-02 at `1.0.0-alpha.3`, it has these gaps for this app:
   - Teams (create, update, remove, add and remove members) are roadmap phases 14 and 15,
     outside its v1 scope. This app uses all five.
   - It hashes passwords with Argon2. Better Auth's default is scrypt, which this app's
     password users (development and demo seeds) have.
   - This app's hooks (name checks, the login domain policy, refusing unverified sign-ups,
     the rate-limit rules) must fit its plugin model.
   - It runs on Axum, Tokio, and SeaORM. Auth flows are rare, but the per-request session
     check should stay a cookie signature check in this app's own code.
   - It's an alpha with two main maintainers. Its schemas can change between alphas.

   It names Google and GitHub providers, the two production uses. Microsoft sign-in can go
   if it costs work (Kait, 2026-10-02). A spike runs the app's sign-in, passkey,
   invitation, API key, and device authorization flows against it on this app's schema.
   If it holds, the native backend is in Rust.

   Teams have two ways out, to choose before the port starts:
   - Recommended: take teams out of Better Auth in today's app. The teams domain already
     owns team roles and the team lists (`src/server/teams/teams.server.ts`). It takes the
     five writes too, with the name checks and `teamsPerOrganization`, and Better Auth's
     `teams.enabled` goes off. An invitation's team becomes this app's own step after the
     invitation is accepted, and removing a member removes their team memberships in the
     hook that already stops their timer. Both backends then treat teams like projects,
     and better-auth-rs needs no team support.
   - A teams plugin for better-auth-rs, limited to the five calls this app makes, built so
     the official one can replace it: the routes, payloads, and error codes of
     `better-auth@1.7.6`, checked with the project's compatibility harness against the
     TypeScript server, shaped like its organization plugin, and offered upstream as
     phases 14 and 15. On 2026-10-02 nobody had started them: no branch, pull request, or
     issue, and no team tables in its schema. Invitations to a team and member removal
     live in better-auth-rs's organization plugin, and its plugin trait has no hook that
     runs after another plugin's route, so this way also patches that plugin, upstream or
     in a fork.

   Either way, a small redesign of how this app uses teams is open for discussion if it
   makes the port simpler. For example, invitations could name only the organization,
   with admins adding the person to teams after they join, which takes teams out of the
   invitation endpoints. The agent brings such changes to Kait before making them.

6. The language, if question 5 doesn't settle it: Rust or Zig. Criteria: control over
   allocation, memory safety in a server that parses untrusted input, SQLite interop,
   libraries for passkeys and OAuth, and how reliably an AI session writes and ports it.

## Proof of concept

The hot path in the native backend: session check, running timer, start and stop, entry
list, and the week report, on the same database file, measured with task 078's harness.
The frontend reaches it through the adapter for those calls.

## Acceptance criteria

- [ ] Each question above answered with numbers, recorded in this task
- [ ] A decision record in `docs/architecture/`: language, auth, contract, and adapter,
      with what was rejected and why
- [ ] The changes to the TypeScript app listed, teams included
- [ ] The proof of concept measured against task 078's baseline: CPU per request kind, RSS
      at idle and peak, and capacity
- [ ] A follow-up task for parity and the generation workflow, if the numbers justify a
      second backend

## Out of scope

TLS, certificates, and static files in the binary (Caddy stays), Turso's engine, and
changes to the Vercel deployment beyond the adapter.
