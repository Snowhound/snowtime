# 081.03: The Rust libraries, chosen on a small port of the timer

Status: in-progress (proof of concept measured 2026-10-04; libraries not chosen)

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

## Proof of concept

Built overnight on 2026-10-04 in `native/` (`native/README.md`), on the branch
`081-native-poc`. Three candidates serve the same slice of the JSON API:

| Binary                   | HTTP             | Queries                                |
| ------------------------ | ---------------- | -------------------------------------- |
| `snowtime-axum`          | Axum 0.8.9       | `rusqlite` 0.40.2 with SQL strings     |
| `snowtime-axum-seaquery` | Axum 0.8.9       | SeaQuery 1.0.2, executed on `rusqlite` |
| `snowtime-actix`         | Actix Web 4.15.0 | `rusqlite` 0.40.2 with SQL strings     |

All run on Tokio 1.53 with SQLite 3.53.2 compiled in (the TypeScript server's libSQL is
SQLite 3.45.1). Rocket, Diesel, and sqlx weren't tried.

### The slice

The calls `getRunningTimer`, `startTimer`, `stopTimer`, `listEntries`,
`getFirstEntryStart`, `createEntry`, `updateEntry`, `deleteEntry`, `listProjects`, and
`checkAvailability`, and email sign-in at `/api/auth/sign-in/email`. `getAppSession`, which
the browser calls after every action, isn't in it: its fill summary needs the taglines and
holiday code. Neither are the reports, settings, teams, or the page render of subtask 01.

### How the port is built

- **The contract drives routing.** A crate free of any HTTP library, `api`, does what
  `src/server/api.server.ts` does: it finds the call in a table like `operations.ts`,
  checks `Origin` on writes, reads the input, checks the session, counts the write rate,
  and runs the call's rule. Axum and Actix only turn their request into that crate's
  `Request` and back: 85 code lines for Axum with its two binaries, 55 for Actix. So the
  HTTP library doesn't change the porting effort; it shows only in CPU and memory.
- **Rules look like the TypeScript.** One Rust module per TypeScript file, one function per
  rule, taking `(db, scope, input)` and returning `Result<T>`. `refuse(Code::NotFound,
Key::EntryNotFound)` stands for `throw new AppError(...)`. serde reads inputs and a
  `validate` method applies valibot's pipes, with the same messages. Outputs are serde
  structs in the field order the TypeScript sends.
- **One connection.** The database is one `rusqlite` connection behind a mutex. Each
  request runs on Tokio's blocking pool and holds the connection for its call, as the
  TypeScript server's `oneAtATime` (`src/db/connection.ts`) serializes statements. The
  connection takes libSQL's defaults: foreign keys on, a 5-second busy timeout, and the
  file's journal mode (`delete`).
- **Its own sign-in.** It verifies Better Auth's scrypt hash (N 16384, r 16, p 1, a 64-byte
  key over the NFKC password, the salt used as its hex text), checked against a hash from
  `better-auth/crypto`. It writes the session row as Better Auth's `createSession` does and
  sets the same cookie, signed as better-call signs it. The session check verifies the
  signature, reads the session row joined to its user, deletes an expired one, and renews
  one a day old. Not ported: Better Auth's cookie cache (`session_data`), so every check
  reads the row; the sign-in rate limit; `rememberMe: false`; and the login domain policy.
- **Clock and timing.** `PERF_NOW` moves the clock as `perf/lib/clock.ts` does. API
  responses carry task 088's `Server-Timing` with `session` and `db`. The native `db` is
  each statement's time from start to end, from SQLite's trace hook; SQLite's own profile
  times count whole milliseconds. Unlike the TypeScript `db`, it leaves out waiting for the
  connection.

### Conformance and byte equality

- `conformance/timer.conformance.ts`: 13 of 13 tests pass on all three binaries and on the
  TypeScript build, none skipped (`bun native/bench/conformance.ts <binary>`).
- `native/bench/compare.ts` sends 22 calls to the TypeScript build and a binary, each on
  its own copy of the benchmark database at `SEED_NOW`: reads as the owner and as a member,
  the week's and 92 days' entries (1.66 MB), `listProjects` with and without archived
  projects, and refusals. All three binaries answer every call with the same status and
  the same bytes: key order, entry order, and valibot's messages included.

### Porting effort

Code lines (not blank or only a comment) of each rule and its helpers
(`bun native/bench/lines.ts rules-sql rules-seaquery`):

| Rule                  | TypeScript | SQL strings | SeaQuery |
| --------------------- | ---------: | ----------: | -------: |
| Scope                 |         50 |          55 |       67 |
| `assertUsableProject` |         21 |          28 |       52 |
| Entry columns         |         10 |          14 |       22 |
| Entry checks          |         49 |          62 |       66 |
| `createEntry`         |         33 |          39 |       50 |
| `updateEntry`         |         49 |         107 |       70 |
| `deleteEntry`         |          9 |          19 |       19 |
| `getFirstEntryStart`  |         12 |          16 |       17 |
| `listEntries`         |         20 |          34 |       27 |
| Timer helpers         |         29 |          37 |       61 |
| `listProjects`        |         33 |          46 |       67 |
| `startTimer`          |         45 |          64 |       75 |
| `stopTimer`           |          5 |           6 |        6 |
| `getRunningTimer`     |         22 |          31 |       36 |
| Total                 |        387 |         558 |      635 |

- Every rule translates line by line: the same checks in the same order, the same errors,
  and the same comments. `Promise.all` and `allInOrder` become calls in order, which throw
  the same first error. Drizzle's `.set()` with `undefined` fields becomes a `Patch` field
  (absent, null, or a value). `failedConstraint` still matches SQLite's message.
- SQL strings take 1.44 times the TypeScript's lines and SeaQuery 1.64 times. rustfmt puts
  each builder call on its own line, and SeaQuery names tables and columns twice
  (`(TimeEntry::Table, TimeEntry::UserId)`). SQL strings lose only where a statement is
  built from parts: `updateEntry`'s `SET` of the fields present takes 107 lines against
  SeaQuery's 70.
- The SQL strings crate and the Actix server compiled the first time. SeaQuery needed three
  fixes: `sea-query-rusqlite` 0.8 needs `rusqlite` 0.38, which can't link beside 0.40, so
  the crate binds values itself in 30 lines; its comparison methods moved to the
  `ExprTrait` trait in 1.0, which one import fixed; and it binds `LIMIT` as a `u64`, which
  the binder lacked (one test failed with a 500). Writing `sys_deleted = 0` as a literal
  for SQLite's partial indexes takes `Expr::cust("0")`.
- **A further handler.** Two fresh agent sessions (Opus 5.5) each ported `listProjects`,
  one per query layer, in a worktree of their own, given the ported rules as examples and
  `compare.ts` to check against. Both had no compile errors and no difference from the
  TypeScript's bytes on their first run: SQL strings in about 8 minutes, SeaQuery in about
  6 with one build. Both found the two facts that would have broken byte equality and that
  the TypeScript doesn't state: the answer's field order isn't the schema's, because
  `runOperation` doesn't parse outputs, and the order of `teamIds` follows the index SQLite
  picks, so both kept the TypeScript's query. Both wrote their own helper for a boolean in
  a GET's query string, and both noted that the shared call table routes a call to a rules
  crate that hasn't ported it, which panics into a 500 instead of a 404.

### Found on the TypeScript side

- `perf:stress`'s scenario still told calls apart by `/_serverFn/`, so after task 084
  every `/api/v1` call counted as a page, with a 1-second target, and wasn't batched. This
  branch counts them as `api`, batched as server functions were.
- `perf/stress/dataset.ts` writes running timers' `started_at` and users' `created_at` with
  fractions of a millisecond, so SQLite stores them as REAL: 170 entries and 97 users in M.
  JavaScript reads them as numbers; `rusqlite` refused them, failing 15% of users, until
  `Timestamp` read a REAL as `new Date` does. The generator should round them.
- `ListedProject`'s schema lists `teamIds` before `hasEntries`; the API sends the reverse.

## Acceptance criteria

- [ ] The small app working with at least two HTTP and two query candidates, passing the
      same conformance tests (met on 2026-10-04 except the page render and the in-process
      path for the isolate)
- [ ] The measurements above, recorded in this task
- [ ] The chosen libraries, with what was rejected, in 081's decision record
