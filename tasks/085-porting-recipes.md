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
