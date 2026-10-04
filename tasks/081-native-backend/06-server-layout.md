# 081.06: The Rust server's layout and routing

Status: in-progress

How the full port is laid out. The proof of concept (subtask 03) split its code into crates
so its candidates could share it. It routed every request through one catch-all handler and
a copy of the TypeScript call table. Task 089 replaces that table in the TypeScript app
with Hono routers per domain and client functions per domain. This subtask gives the Rust
server the same shape, so a change on one side maps file for file onto the other.

## Decided

Kait, 2026-10-04:

- **Axum for now.** Actix Web stays an option until subtask 01's render isolate (deno_core
  with V8) runs in the host. Axum and Actix measured the same CPU and memory in subtask 03.
  If keeping one isolate per worker turns out much simpler than running isolates on threads
  of their own, that favors Actix. deno_core's `JsRuntime` can't be sent between threads.
  Actix runs handlers on single-threaded workers, while Axum handlers must be `Send`.
- **rusqlite with SQL strings**, with three helpers in `queries.rs`. SeaQuery is rejected
  (subtask 03, "Recommendation").
- **Framework routes per domain**, mirroring task 089's Hono routers. There's no Rust copy
  of the call table.

## Layout

One library crate holds the domains, and one binary hosts it. Rust crates can't depend
on each other in a cycle, and the domains import each other (`entries` uses
`projects::assert_usable_project`). Modules cost nothing at run time, and one crate of this
size rebuilds in about 2 s after a change (subtask 03, "Build and size").

```text
src/server/                       native/crates/server/src/   library: no HTTP server
  <domain>/<domain>.server.ts  →    <domain>/mod.rs           the rules: entries::update_entry
  <domain>/<domain>.schemas.ts →    <domain>/schemas.rs       serde structs + validate
  <domain>/<domain>.routes.ts  →    <domain>/routes.rs        Axum routes, one-line handlers
  <domain>/<domain>.test.ts    →    <domain>/tests.rs
  scope · guards · queries · errors · schemas · limits · rate-limit · timing  →  same names, .rs
  auth/                        →    auth/                     differs: no Better Auth inside
src/lib/api/wire.ts            →    wire.rs
src/lib/calendar.ts            →    calendar.rs               the reports need it
src/db/connection.ts           →    db.rs
(Start's server and render)    →  native/crates/host/        binary: Axum, pages, render isolate
```

- Don't name a file `entries/entries.rs`: Clippy's `module_inception` lint flags it. With
  the rules in `entries/mod.rs`, a call reads `entries::update_entry(db, &scope, input)`,
  as the TypeScript reads `entries.updateEntry(db, scope, input)`.
- Split the proof of concept's single `core/src/schemas.rs` into one `schemas.rs` per
  domain. Drop its `Rules` trait, which existed only to swap query layers, and the
  `rules-seaquery`, `server-actix`, and `core` crates once their code has moved. Keep the
  Actix adapter on a branch, or in git history, until the Axum decision is final.

## Routing

Each domain's `routes.rs` mirrors its `<domain>.routes.ts`, and one extractor does what
task 089's middleware does:

```rust
// server/src/entries/routes.rs
pub fn routes() -> Router<App> {
    Router::new()
        .route("/entries", get(list).post(create))
        .route("/entries/first-start", get(first_start))
        .route("/entries/{id}", patch(update).delete(delete))
}

async fn update(call: InOrganization<UpdateEntryInput>) -> Reply<Entry> {
    call.run(super::update_entry).await
}
```

`InOrganization<T>` (with `AsUser<T>` and `Public<T>` beside it) does the following:

1. Checks `Origin` on writes against the public URL.
2. Merges the path parameters with the query string of a GET or the JSON body.
3. Decodes and validates the input, answering with valibot's messages.
4. On Tokio's blocking pool, holds the one connection for the session check, the scope,
   the write rate limit, and the rule. This is what `Api::answer` in
   `native/crates/api/src/lib.rs` does now, and the code moves into the extractor.
5. Maps refusals and database failures to the wire format.

A route that only reads despite being a POST is marked as task 089 marks it.

Axum's built-in `Json`, `Path`, and `Query` extractors answer bad input with their own
plain-text 400 and 422 responses. The custom extractors must use the API's error body
instead, or the conformance tests' byte comparison fails.

**Server rendering** calls the API through the router in process:
`router.clone().oneshot(request)`, with the page request's cookie. The render isolate's
host function takes a method, path, and body, as task 089's `request` sends them. Check
this with subtask 01. Axum's router is a tower `Service`, which makes this possible. Actix
has no supported in-process call outside its test utilities, so this also counts for Axum.

**Unported calls.** A route that isn't ported isn't registered, so it answers 404. In the
proof of concept, such calls panicked into a 500.

## Helpers in `queries.rs`

About 80 lines, so composed SQL reads like Drizzle's ``sql`...` ``:

- **`sql!` and `Sql` fragments.** Literal text becomes SQL, a `Sql` value is spliced in
  with its parameters, and any other value is bound as `?`. Only string literals become
  text, so a value can't end up pasted in as SQL. This removes the manual ordering of
  values that `list_entries` in `native/crates/rules-sql/src/entries.rs` does today.
- **`Assignments`.** It builds a `SET` from the fields present (`Patch`: absent, null, or
  a value), which `update_entry` writes out inline today, in 107 lines against SeaQuery's 70.
- **`list(values)`.** It builds `(?, ?, ...)` for `in`.

rusqlite caches 16 prepared statements by default, and `prepare_cached` keys on the
statement text. Report filters whose text changes with the length of a user list would
evict each other. Raise the capacity
(`set_prepared_statement_cache_capacity`), or bind the list as one JSON value
(`user_id in (select value from json_each(?))`) after checking the query plan.

## Acceptance criteria

- [ ] The workspace restructured as above, with the proof of concept's slice moved into
      `server` and `host`, and the conformance and `compare.ts` checks passing
- [ ] Routes per domain, matching task 089's Hono routers path for path
- [ ] The extractors written, with error bodies byte-equal to the TypeScript server's
- [ ] `sql!`, `Assignments`, and `list` written, and the ported rules using them
- [ ] An unported call answers 404
- [ ] Server rendering through `oneshot` proven with subtask 01, or the reason it can't be
- [ ] The Axum or Actix decision confirmed once subtask 01's isolate runs, and recorded in
      task 081's decision record

## Implementation

2026-10-04: Step 1 moves the ported slice into `server` and `host`, splits domain schemas,
and replaces the trait and call table with domain routers and typed extractors. The
extractors preserve task 089's check order: origin, session and rate, organization, input,
rule. One blocking call holds the connection across those checks and the rule. The
TypeScript byte comparator now fails on byte differences, including key order.

The Actix adapter remains at `61467c1:native/crates/server-actix/` in git history.
The binary name remains `snowtime-axum`, including Docker's `BIN` and stress's `NATIVE_BIN`.

Step 1 checks: `cargo test` (12 tests), `cargo clippy --all-targets -- -D warnings`,
conformance (13/13), comparison (22/22 byte-equal), and `bun run test` (445 Bun tests and
179 component tests) pass. A test calls the real timer route with a page cookie through
`Router::oneshot`; subtask 01's isolate is still unimplemented.
