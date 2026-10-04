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
`checkAvailability`, and email sign-in at `/api/auth/sign-in/email`. `getAppSession`,
which the browser calls after every action, isn't in it: its fill summary needs the
taglines and holiday code. Neither are the reports, settings, teams, or the page render of
subtask 01.

### How the port is built

- **The contract drives routing.** A crate free of any HTTP library, `api`, does what
  `src/server/api.server.ts` does: it finds the call in a table like `operations.ts`,
  checks `Origin` on writes, reads the input, checks the session, counts the write rate,
  and runs the call's rule. Axum and Actix only turn their request into that crate's
  `Request` and back: 85 code lines for Axum with its two binaries, 55 for Actix. So the
  HTTP library doesn't change the porting effort; it shows only in CPU and memory.
- **Rules look like the TypeScript.** One Rust module per TypeScript file, one function
  per rule, taking `(db, scope, input)` and returning `Result<T>`. A call of `refuse` with
  a code and a key stands for `throw new AppError(...)`. serde reads inputs and a
  `validate` method applies valibot's pipes, with the same messages. Outputs are serde
  structs in the field order the TypeScript sends.
- **One connection.** The database is one `rusqlite` connection behind a mutex. Each
  request runs on Tokio's blocking pool and holds the connection for its call, as the
  TypeScript server's `oneAtATime` (`src/db/connection.ts`) serializes statements. The
  connection takes libSQL's defaults: foreign keys on, a 5-second busy timeout, and the
  file's journal mode (`delete`).
- **Its own sign-in.** It verifies Better Auth's scrypt hash (N 16384, r 16, p 1, a
  64-byte key over the NFKC password, the salt used as its hex text), checked against a
  hash from `better-auth/crypto`. It writes the session row as Better Auth's
  `createSession` does and sets the same cookie, signed as better-call signs it. The
  session check verifies the signature, reads the session row joined to its user, deletes
  an expired one, and renews one a day old. Not ported: Better Auth's cookie cache
  (`session_data`), so every check reads the row; the sign-in rate limit; sessions that
  aren't remembered (`rememberMe`); and the login domain policy.
- **Clock and timing.** `PERF_NOW` moves the clock as `perf/lib/clock.ts` does. API
  responses carry task 088's `Server-Timing` with `session` and `db`. The native `db` is
  each statement's time from start to end, from SQLite's trace hook; SQLite's own profile
  times count whole milliseconds. Unlike the TypeScript `db`, it leaves out waiting for
  the connection.

### Conformance and byte equality

- `conformance/timer.conformance.ts`: 13 of 13 tests pass on all three binaries and on the
  TypeScript build, none skipped (`bun native/bench/conformance.ts <binary>`).
- `native/bench/compare.ts` sends 22 calls to the TypeScript build and a binary, each on
  its own copy of the benchmark database at `SEED_NOW`: reads as the owner and as a
  member, the week's and 92 days' entries (1.66 MB), `listProjects` with and without
  archived projects, and refusals. All three binaries answer every call with the same
  status and the same bytes: key order, entry order, and valibot's messages included.

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
- The SQL strings crate and the Actix server compiled the first time. SeaQuery needed
  three fixes: `sea-query-rusqlite` 0.8 needs `rusqlite` 0.38, which can't link beside
  0.40, so the crate binds values itself in 30 lines; its comparison methods moved to the
  `ExprTrait` trait in 1.0, which one import fixed; and it binds `LIMIT` as a `u64`, which
  the binder lacked (one test failed with a 500). Writing `sys_deleted = 0` as a literal
  for SQLite's partial indexes takes `Expr::cust("0")`.
- **A further handler.** Two fresh agent sessions (Opus 5.5) each ported `listProjects`,
  one per query layer, in a worktree of their own, given the ported rules as examples and
  `compare.ts` to check against. Both had no compile errors and no difference from the
  TypeScript's bytes on their first run: SQL strings in about 8 minutes, SeaQuery in about
  6 with one build. Both found the two facts that would have broken byte equality and that
  the TypeScript doesn't state: the answer's field order isn't the schema's, because
  `runOperation` doesn't parse outputs, and the order of `teamIds` follows the index
  SQLite picks, so both kept the TypeScript's query. Both wrote their own helper for a
  boolean in a GET's query string, and both noted that the shared call table routes a call
  to a rules crate that hasn't ported it, which panics into a 500 instead of a 404.

### Load: `perf:stress` on M

Task 078's harness on dataset M (1,049 users with sessions, 1.19 million entries, 944 MB),
on this Mac in Docker: the app, Caddy, and the sampler share one core, the app has
1,792 MB, and k6 runs on eight other cores. Both backends replay the same recording, cut
down to the calls the native backend serves (`native/bench/api-recording.ts`): the
returns, timer starts and stops, edits, and sign-ins of the usage model, with their
`/api/v1` calls but without the pages, `getAppSession`, `listProjects`, and the reports.
So a user here sends a fraction of a real user's requests, and the capacities below
count users of this slice, not of the app. The TypeScript image predates the merge of
task 088, so it sends no Server-Timing.

```sh
bun native/bench/api-recording.ts <recording.json> <slice.json>
bun run perf:stress --dataset=M --run=kinds --recording=<slice.json>
bun run perf:stress --app=native --dataset=M --run=kinds --recording=<slice.json>
bun run perf:stress --dataset=M --run=ramp --recording=<slice.json> --step-seconds=60 --hold-seconds=180
bun run perf:stress --app=native --dataset=M --run=ramp --recording=<slice.json> --step-seconds=60 --hold-seconds=180 --from=5000
```

Each action alone at 2 a second for 60 seconds (`--run=kinds`), app CPU per action, Axum
with SQL strings against TypeScript:

| Action  | Requests | TypeScript ms | Native ms | Ratio |
| ------- | -------: | ------------: | --------: | ----: |
| Return  |        3 |          23.1 |       2.4 |  9.6× |
| Timer   |        3 |          22.8 |       3.2 |  7.1× |
| Edit    |        4 |          19.3 |       5.6 |  3.4× |
| Sign-in |        4 |          81.1 |     137.3 |  0.6× |

The whole TypeScript app, replaying the full recording the same way, spends 56 ms on
opening the timer page (its server render), 29 ms on a return with its five calls, 31 on a
timer action, 29 on an edit, 26, 60, and 93 on a week's, a month's, and a year's report,
27 on an export, and 103 on a sign-in with the calls after it. The Axum, Actix, and
SeaQuery candidates spend the same within noise at this rate: 2.4–2.8 ms on a return,
3.2–3.3 on the timer, 3.8–5.6 on an edit, and 137 on a sign-in, with 5 MB RSS at idle.

Sign-in is slower natively. In Docker on Linux, the `scrypt` crate takes 113 ms a hash
against 52 ms for Bun's `node:crypto`; on macOS the two take 59 and 53 ms. Neither target
CPU flags nor keeping glibc from returning scrypt's 32 MB buffer changed it; the cause
isn't found.

The ramp, one minute a step, until a 30-second window's p95 passes a target. Requests a
second are those offered; CPU is a share of the one core:

|   Users | Req/s | TS app CPU | TS anon / RSS MB | Native app CPU | Native anon / RSS MB | Caddy CPU, TS / native |
| ------: | ----: | ---------: | ---------------: | -------------: | -------------------: | ---------------------: |
|   5,000 |    66 |        15% |        127 / 187 |           3.7% |               4 / 42 |             4.2 / 4.6% |
|  10,000 |   133 |        21% |        140 / 236 |           8.4% |               4 / 42 |             5.6 / 7.2% |
|  20,000 |   261 |        33% |        148 / 246 |            15% |               5 / 43 |                9 / 10% |
|  40,000 |   526 |        61% |        169 / 268 |            22% |              12 / 68 |               17 / 15% |
|  50,000 |   641 |  70%, miss |        280 / 399 |            28% |              29 / 79 |               21 / 17% |
|  80,000 | 1,047 |          — |                — |            41% |             46 / 153 |                — / 27% |
| 100,000 | 1,215 |          — |                — |      45%, miss |             97 / 186 |                — / 43% |

- **Capacity.** TypeScript held its targets up to 40,000 users of the slice (526 requests
  a second) and missed at 50,000; the native server held 80,000 (1,047 a second) and
  missed at 100,000. Both stopped when the shared core filled: at its miss, TypeScript's
  app took 70% and Caddy 21%; the native app took 45% and Caddy 43%, with Caddy at its 512
  MB limit. With Caddy on the same core, Caddy is what limits the native server.
- **CPU per request** at load: TypeScript 1.2 ms, native 0.4 ms, Caddy 0.26–0.35 ms for
  either. TypeScript's cost falls from 7 ms at 200 users to 1.2 ms as its JIT warms and
  requests overlap; the native cost stays at 0.4–0.6 ms. Sign-in's scrypt, at 0.1 a user
  an hour and about 113 ms each, is much of the native app's CPU: about 37% of it at
  10,000 users and 60% at 80,000.
- **Memory.** At idle the TypeScript app holds 97 MB RSS (44 MB anonymous) and the native
  one 5 MB (1 MB anonymous). Under load the native server's anonymous memory stays at 4–12
  MB up to 40,000 users, and its RSS peaks include scrypt's 32 MB buffer, one per sign-in
  running. Beyond that it grows with load, to 97 MB anonymous and 186 MB RSS at 100,000
  users. The likely cause is Tokio's blocking threads waiting for the connection, each
  with its stack; that isn't confirmed. The app's cgroup also counts the database's page
  cache, 60–95 MB natively.
- **Holds.** The ramp's holds failed for TypeScript at 40,000, 30,000, and 25,000 users on
  error share alone (0.12–0.24%, the limit is 0.1%), with latency within targets; the
  native hold at 80,000 stopped when the sampler's log read failed. Every error was a 404
  from `stopTimer`: the scenario remembers a started timer per virtual user, so when two
  virtual users act for the same person, the later start stops the earlier timer and the
  earlier user's stop finds none. At 40,000 users each of M's 1,049 people stands for 38.
  The capacities above therefore come from the one-minute steps.

### Each candidate at a fixed load

With Caddy on a core of its own (`--caddy-cpuset=0`), each candidate served 80,000 users
of the slice (1,050 requests a second) for two minutes, and the TypeScript server 40,000:

| Server             |  Users |     App CPU | Anon MB | RSS peak MB | p95 of returns ms |
| ------------------ | -----: | ----------: | ------: | ----------: | ----------------: |
| Axum, SQL strings  | 80,000 | 42.7, 40.5% |  43, 39 |    123, 100 |           126, 88 |
| Actix, SQL strings | 80,000 | 39.0, 42.6% |  41, 45 |    113, 138 |            84, 87 |
| Axum, SeaQuery     | 80,000 |       46.4% |      68 |         149 |                95 |
| TypeScript         | 40,000 |       61.3% |     163 |         290 |                39 |

Axum and Actix ran twice each, in opposite orders; they swapped places, so the HTTP
library makes no difference this harness can measure. SeaQuery took about 10% more CPU
than SQL strings in its one run, likely from building each statement's text at run time.
Every server spent 0.26–0.31 ms of Caddy's CPU a request. The native p50 is 1 ms, but its
p95 is 84–126 ms at 80,000 users, against TypeScript's 39 ms at half that load. Sign-in's
113 ms of scrypt on the one core, at 2.2 sign-ins a second, is the likely cause; that
isn't confirmed.

### Server-Timing

Medians of 100 calls each, one at a time, as the owner on the benchmark database at
`SEED_NOW` (`bun native/bench/timings.ts <binary> 100`), in milliseconds; the total is
the client's time for the whole call:

| Call                   | TS session | TS db | TS total | Native session | Native db | Native total |
| ---------------------- | ---------: | ----: | -------: | -------------: | --------: | -----------: |
| `getRunningTimer`      |        0.3 |   0.1 |      1.0 |            0.0 |       0.0 |          0.2 |
| `listEntries`, a week  |        0.2 |   0.6 |      2.2 |            0.0 |       0.1 |          0.6 |
| `listEntries`, 92 days |        0.3 |   9.3 |     22.3 |            0.0 |       3.0 |          9.5 |
| `startTimer`           |        0.2 |   0.9 |      1.6 |            0.0 |       0.4 |          0.6 |

The native numbers are Axum with SQL strings; SeaQuery and Actix are within 0.1 ms of them
except SeaQuery's 92 days, at 3.2 and 9.9 ms. The native session check, a signature and
one indexed read, stays under 0.05 ms. For 92 days, the time outside the database, which
includes turning 1.66 MB of rows into JSON and sending it, is 13 ms in TypeScript and
6.5 ms natively.

### Build and size

On this Mac (Apple M-series, 10 cores):

| Build                                     | Clean release | After a change to `core` | After a change to the rules | Binary, stripped |
| ----------------------------------------- | ------------: | -----------------------: | --------------------------: | ---------------: |
| `snowtime-axum`                           |        19.9 s |                    2.1 s |                       1.7 s |   4.4 MB, 3.7 MB |
| `snowtime-axum-seaquery`                  |        20.2 s |                    2.6 s |                       2.3 s |   4.8 MB, 4.0 MB |
| `snowtime-actix`                          |        21.3 s |                    1.8 s |                       1.5 s |   5.2 MB, 4.1 MB |
| TypeScript, `build:binary --target=arm64` |         7.9 s |                        — |                           — |    106 MB server |

The Linux image of a candidate is 166 MB, most of it Debian and `curl` for the health
check, with a 4.9 MB binary; the TypeScript release image is 784 MB. A Docker build of a
candidate with Cargo's caches mounted takes 44 s from nothing and 2–13 s after a change.

### Recommendation

For Kait to decide; not yet in 081's decision record.

- **Axum with `rusqlite` and SQL strings.** Axum and Actix cost the same CPU and memory
  within the noise of these runs, so ease of porting decides between them, and with the
  contract table either only carries requests. Axum is what better-auth-rs runs on
  (question 5), and it runs on Tokio, as the Deno extension crates subtask 01 plans to
  start from do. Actix Web would serve as well. SQL strings took 12% fewer lines than
  SeaQuery and about 10% less CPU, need no binder and no wait for SeaQuery to catch up
  with `rusqlite`, and keep the statement text a reader can compare with Drizzle's and
  with `EXPLAIN QUERY PLAN`. The agents ported a handler as well with either.
- **What SQL strings need.** A helper for a `SET` of the fields present, as `updateEntry`
  needs, and the `in (...)` helper the crate has; a helper for GET booleans and numbers in
  `core`; and each rules crate declaring its calls, so an unported call answers 404.
- **Rejected for now.** SeaQuery, for more lines and more CPU with no measured gain.
  Rocket, Diesel, and sqlx weren't tried. With the contract table, Rocket's attribute
  routes would have nothing to declare.

### Open

- Server rendering in the Axum server (subtask 01) and RSS with the isolate: not started.
- The rest of the hot path: `getAppSession`, which every action calls, and the week
  report.
- Scrypt on Linux takes twice Bun's time; a binding to OpenSSL's or aws-lc's scrypt would
  show whether the crate or the VM is the cause. Each sign-in also holds a 32 MB buffer,
  so sign-ins running at once raise RSS by that much each.
- RSS grows with Tokio's blocking threads under overload. A fixed number of database
  workers, or one thread that owns the connection, would cap it.
- The one connection serializes every call, as the TypeScript server does. A pool on WAL
  would let reads run beside a write, at the cost of changing the file's journal mode.
- Better Auth's cookie cache isn't ported; the native session check reads the row on every
  call, which costs it under 0.05 ms.
- `perf:stress`: a virtual user's `stopTimer` 404s when another virtual user started a
  timer for the same person, which fails the ramp's holds on error share above 25,000
  users of M. The scenario should treat that 404 as expected, or give each person one
  virtual user. The datasets' REAL timestamps should become integers.
- The measurements ran on this Mac in Docker, not on Hetzner, and on M, not L.

### Found on the TypeScript side

- `perf:stress`'s scenario still told calls apart by `/_serverFn/`, so after task 084
  every `/api/v1` call counted as a page, with a 1-second target, and wasn't batched. This
  branch counts them as `api`, batched as server functions were.
- `perf/stress/dataset.ts` writes running timers' `started_at` and users' `created_at`
  with fractions of a millisecond, so SQLite stores them as REAL: 170 entries and 97 users
  in M. JavaScript reads them as numbers; `rusqlite` refused them, failing 15% of users,
  until `Timestamp` read a REAL as `new Date` does. The generator should round them.
- `ListedProject`'s schema lists `teamIds` before `hasEntries`; the API sends the reverse.

## Acceptance criteria

- [ ] The small app working with at least two HTTP and two query candidates, passing the
      same conformance tests (met on 2026-10-04 except the page render and the in-process
      path for the isolate)
- [x] The measurements above, recorded in this task
- [ ] The chosen libraries, with what was rejected, in 081's decision record
