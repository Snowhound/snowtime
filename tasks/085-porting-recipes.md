# 085: A general repository of porting recipes

Status: todo (the last step: waits on task 081's port working and measured)

Kait's goal (2026-10-03): what task 081 learns becomes a separate repository of recipes,
skills, and codemods for porting a modern cloud app to one Rust server with a local SQLite
database, first on one instance and later with Turso. AI sessions do the porting; the
repository gives them guidelines, because each port differs. It starts from this app's
stack (SolidJS, TanStack Start, Drizzle, Better Auth) and may later cover others, such as
SvelteKit or Postgres.

## What goes in

Only what an AI session can't quickly work out itself, because models keep improving at the
rest:

- The method: port from a given commit, the conformance tests define done, make it work
  and then make it fast, measure against a load model (task 078).
- Findings that took measurement or failure to learn, such as Start addressing server
  functions by a build hash (task 081.02), the V8 isolate's memory floor (task 081.01),
  and better-auth-rs hashing passwords with Argon2 where Better Auth uses scrypt.
- Mapping tables from each layer to its port: Drizzle to the chosen query crate, a server
  function to a handler, Better Auth to better-auth-rs (task 081.03).
- Codemods, as small scripts in whatever language a session handles best, for conversions
  that recur across apps, such as a Drizzle schema to the Rust schema and models.
- The V8 host recipe: rendering in an embedded isolate, with native code for the hot
  paths. Other code that is costly to port and rarely run can stay in the isolate too,
  such as Paraglide's message formatting or the export. Drizzle's migrations are SQL
  files with a journal table, so Rust applies them without the isolate.

Code templates stay out; AI sessions write those well.

## The workflow

Kait, 2026-10-03: a port runs in three steps, and the session proposes nothing before the
user has checked what it found.

1. **Survey.** The session reads the app and lists everything that needs porting, by
   layer: frontend and server framework, how the client reaches the server (server
   functions, an API, or both), serialization, middleware, ORM and database, migrations,
   auth and its plugins, background work, i18n, and anything else the server runs. Each
   item names where the app uses it and how much: for example 41 server functions in 9
   files.
2. **Check with the user.** The session presents the list. The user confirms it, corrects
   it, and adds what code can't show, such as which features may be dropped and which
   deployments must keep working.
3. **Propose.** Only then does the session propose a port for each item, from the
   recipes, or marks the item as having no recipe yet.

## Starting from server functions

An app whose client calls server functions, as this one does, is a supported starting
point. A Rust server can't serve server functions (task 081.02), so the port goes through
a middle step: the app keeps its server functions and gains the JSON API beside them, as
task 084 did for the timer. Each server function gets an operation (method, path, input
and output schemas), its logic sits in a rule shaped `(db, scope, input)` that both the
server function and the API call, and conformance tests over HTTP define what the Rust
port must pass.

Before that step, the session checks that each server function can move to the API, and
reports one of three verdicts for each:

- **Transferable:** its input and output are JSON, with dates decoded by the schemas; its
  logic is in a rule or can move into one; its middleware is a check the API can repeat
  (session, scope, rate limit).
- **Transferable with changes:** for example, it returns a `Map`, a class instance, or
  internal columns; it sets cookies or redirects; it reads the request inside its logic.
  The report says what to change.
- **Not transferable as is:** for example, it streams, returns a raw `Response`, or takes
  `FormData`. The report says why and suggests another way, which the user decides on.

The user reviews the report as part of step 2.

The move from server functions to the API is a standard recipe (Kait, 2026-10-03), not a
step only this app needed: task 084 does it for all of this app's calls. Its rules
include that a GET only reads. A read works out what it needs, and only an explicit write
saves it, so a read that repairs state (an active organization, a cookie, a missing row)
becomes a derived value plus an idempotent write. The auth library's sliding session is
the one accepted exception.

## Shape

- An index skill routes a session to recipes by layer: frontend framework, server
  framework, ORM, auth, and database.
- Each recipe says when it applies, its steps, its pitfalls, and how to verify the
  result.
- Each recipe has the date it was checked and the library versions, so a session can tell
  when to check again.
- A stack nobody has ported yet is marked as not written, not filled with guesses.

## Acceptance criteria

- [ ] Recipes written only for steps proven in task 081's port
- [ ] Codemods only for conversions done by hand at least once, with their tests
- [ ] The V8 host moved to its own crate once a second app needs it; until then it keeps a
      clean boundary in the port (isolate pool, host functions, bundle loading)
- [ ] A fresh AI session ports a further handler or a small app using only the
      repository, and the gaps it hits are fixed
- [ ] The workflow above written as the repository's entry point: the survey, the user's
      check, then proposals
- [ ] The transferability check for server functions, run on this app's 41 and checked by
      hand, and the middle step to the API written as a recipe from task 084
