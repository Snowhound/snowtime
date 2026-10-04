# 081.03: The Rust libraries, chosen on a small port of the timer

Status: todo

Port a cut-down timer that has every building block of the real app, once per candidate
library, and choose the libraries by how closely the Rust code follows the TypeScript and
by what they cost in CPU and memory. Kait's rule (2026-10-03): ease of porting decides
where it differs measurably and the performance penalty isn't significant. Otherwise
performance decides.

## The small app

One route, the timer, writing one table, `time_entry`, and reading the session and
membership tables it needs, with the real schema and migrations:

- The session check from Better Auth's cookie, and the organization scope
  (`src/server/scope.server.ts`)
- One read (the running timer and the day's entries) and one write (start and stop), with
  validation, `AppError`, and the rate limit
- The JSON contract of subtask 02 for both, and the in-process path the render isolate
  calls
- The page server-rendered in the V8 isolate and hydrated by Start's client (subtask 01)

Each candidate implements the same app, and the TypeScript version of the same handlers
sits beside it for comparison.

## Candidates

- **HTTP:** Axum (handlers as async functions with extractors, close to a server function
  with middleware), Rocket (routes declared by attributes, like controllers), Actix Web.
  All three run on Tokio. A synchronous server, such as `tiny_http` with a thread pool,
  is a baseline for CPU and memory.
- **Queries:** SeaQuery (a query builder, the closest to Drizzle's), Diesel (a typed DSL
  from the schema), sqlx (SQL checked against the database at compile time), and
  `rusqlite` with SQL strings, which lets both backends share SQL (081 question 4).
- **Hashing:** FxHash for server-made keys and `foldhash` for request keys (081, "Port
  approach"), unless a candidate brings its own.

## Measured per candidate

- Lines of Rust against lines of TypeScript for the same handlers, and how many handlers
  translate line by line
- CPU per request and RSS at idle and under task 078's load for the timer's kinds
- Build time and binary size
- How an AI session does on porting a further handler from TypeScript, given the first
  ones as examples: changes needed before it compiles and before the conformance tests
  pass

## Acceptance criteria

- [ ] The small app working with at least two HTTP and two query candidates, passing the
      same conformance tests
- [ ] The measurements above, recorded in this task
- [ ] The chosen libraries, with what was rejected, in 081's decision record
