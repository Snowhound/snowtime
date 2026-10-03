# 081: Native backend

Status: todo (waits on task 078's baseline; builds on task 080; subtask 01 in progress)

A second backend for self-hosting that serves many companies on a fraction of today's
memory and CPU, without a garbage collector in its own code. The TypeScript backend stays
the source of truth and keeps the Vercel deployment. An AI session generates the native
port from a given commit of it. One frontend source works with both. Changes to the
TypeScript app are welcome where they make this task much simpler. The native server
renders pages in an embedded V8 isolate, and the browser hydrates them (subtask 01, Kait,
2026-10-02); task 079's shells, which would have left it the API alone, are cancelled. This
task researches the decisions and proves the gain on the hot path; full parity is a later
task.

## Targets

- Linux on one core, with resident memory under 64 MB, aiming at 32 MB, at task 078's
  peak load on the L dataset, SQLite's own cache included. This target predates server
  rendering: the V8 isolate alone runs at 66–118 MB on macOS (subtask 01), so the target
  with a renderer is open. The domain code makes no OS
  calls outside a thin layer, so a port to a microcontroller without an OS stays possible
  later.
- No garbage collector and, after the first port, no allocation per row on hot paths in
  the Rust code. The V8
  isolate that renders pages has its own collector, which the host schedules. The data layout below says
  how.
- The same SQLite schema and migrations as the TypeScript backend, so a self-hoster can
  switch either way on one file. Turso's engine comes later.
- One process with Caddy in front for TLS and static files. Folding the
  proxy into the binary comes later.

## Port approach

Kait, 2026-10-03:

- **Make it work, then make it fast.** The first port uses the libraries' defaults and
  ordinary allocation. The data layout below comes after, where task 078's numbers show a
  gain; the libraries may already avoid much of the allocation it targets.
- **Libraries are chosen for ease of porting** where a proof of concept shows a measurable
  difference and no significant performance penalty. Handler code should look like the
  TypeScript handlers, and the query layer like Drizzle, as far as a library allows.
  Subtask 03 measures both on a small app.
- **Fast defaults.** FxHash (`rustc-hash`) for keys the server makes itself, such as
  indices and UUIDs from the database. It isn't resistant to collision attacks, so keys
  that come from requests use a seeded hasher such as `foldhash`, hashbrown's default.

## Data layout

Data-oriented, after the prior art of Sebastian Aaltonen (his posts at
[x.com/SebAaltonen](https://x.com/SebAaltonen) and his
[OffsetAllocator](https://github.com/sebbbi/OffsetAllocator), which the `offset-allocator`
crate ports to Rust) and the libraries that follow it. Crates are named for Rust; question
6 can change them.

- Records live in arrays and refer to each other by dense `u32` indices, not pointers or
  IDs. A UUID maps to an index once, where the data enters (a SQLite row, a request), and
  the code after that works on indices. A loop that reads a few fields of many rows gets
  one array per field.
- An array has a fixed capacity by default, sized from the app's limits where one applies
  (`src/server/limits.server.ts`: 500 members, 1,000 projects, and 100 teams per
  organization, and 200 entries per member per day).
- One thin abstraction grows an array when a bound doesn't hold: doubling, which keeps
  indices valid, or fixed-size chunks, which keep addresses valid too. A slot that is
  freed and reused carries a generation counter, so a stale handle fails instead of
  reading another record, as in the `slotmap` crate.
- A request's data lives in an arena that is reset after the response.
- A hash map is fine where arrays would add complexity out of proportion: hashbrown's
  SwissTable, the table behind Rust's `HashMap`, with a seeded hasher for keys that come
  from requests. A small set, such as an organization's projects, can be a sorted array
  with binary search.
- Anything beyond plain fixed arrays is justified with task 078's numbers, as in task 069.

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
3. The frontend adapter. The data layer calls one client module, which calls the contract
   on both backends; the TypeScript app drops server functions (task 084, Kait,
   2026-10-03).

   Task 078 found that behind Caddy the app sees its own URL as `http`, so an `https`
   `Origin` never matches the request's URL. Both backends compare `Origin` with the
   public URL instead, as the JSON API's write check does (`src/server/api.server.ts`).

4. A mechanical port. What the TypeScript side must keep for that (rules that take
   `(db, scope, input)`, SQL both sides share, the contract), and a conformance suite of
   HTTP-level tests on seeded databases that both backends pass. A port is complete when
   the suite passes.
5. Auth through [better-auth-rs](https://github.com/better-auth-rs/better-auth-rs) (MIT or
   Apache-2.0). It targets `better-auth@1.7.6`, the version this app uses, and tests its
   routes, payloads, and cookies against the TypeScript server with the real
   `better-auth/client`, so the frontend's auth calls could stay unchanged. Device
   authorization, which issue #2 chose for `/api/v1` (Kait, 2026-10-02), and API keys,
   which may follow for scripts, are both in its v1 scope.

   Checked on 2026-10-02 at `1.0.0-alpha.3`, it has these gaps for this app:
   - It hashes passwords with Argon2. Better Auth's default is scrypt, which this app's
     password users (development and demo seeds) have.
   - This app's hooks (name checks, the login domain policy, refusing unverified sign-ups,
     the rate-limit rules) must fit its plugin model.
   - It runs on Axum, Tokio, and SeaORM. Auth flows are rare, but the per-request session
     check should stay a cookie signature check in this app's own code.
   - It's an alpha with two main maintainers. Its schemas can change between alphas.

   It names Google and GitHub providers, the two production uses. Microsoft sign-in can go
   if it costs work (Kait, 2026-10-02). A spike runs the app's sign-in, passkey,
   invitation, API key, and device authorization flows against it on this app's schema,
   after task 080. If it holds, the native backend is in Rust.

   It has no teams: they're its roadmap phases 14 and 15, outside its v1 scope, and on
   2026-10-02 nobody had started them. So teams leave Better Auth first (task 080, Kait,
   2026-10-02), and better-auth-rs needs no team support. The rejected way was a teams
   plugin for better-auth-rs. Invitations to a team and member removal live in its
   organization plugin, whose plugin trait has no hook that runs after another plugin's
   route, so the plugin would also have meant patching that one.

6. The language, if question 5 doesn't settle it: Rust or Zig. Criteria: control over
   allocation, memory safety in a server that parses untrusted input, SQLite interop,
   libraries for passkeys and OAuth, and how reliably an AI session writes and ports it.

## Proof of concept

The hot path in the native backend: session check, running timer, start and stop, entry
list, and the week report, on the same database file, measured with task 078's harness.
The frontend reaches it through the adapter for those calls. The isolate server-renders
the timer page and the week report, and the browser hydrates them (subtask 01).

## Acceptance criteria

- [ ] Each question above answered with numbers, recorded in this task
- [ ] A decision record in `docs/architecture/`: language, auth, contract, and adapter,
      with what was rejected and why
- [ ] The changes to the TypeScript app listed
- [ ] The proof of concept measured against task 078's baseline: CPU per request kind, RSS
      at idle and peak, and capacity
- [ ] A follow-up task for parity and the generation workflow, if the numbers justify a
      second backend

## Out of scope

TLS, certificates, and static files in the binary (Caddy stays), Turso's engine, and
changes to the Vercel deployment beyond the adapter.

## Subtasks

- [01](01-server-rendering.md): server rendering in the native backend
- [02](02-api-contract.md): the API contract and the frontend adapter
- [03](03-port-libraries.md): the Rust libraries, chosen on a small port of the timer
- [04](04-perry.md): Perry, a native TypeScript compiler, in place of the isolate or the
  Rust port
- [05](05-porting-recipes.md): a general repository of porting recipes, once the port
  works

Task 084 moved the TypeScript app from server functions to the same API, through one
client module.
