# Architecture

The decisions the code follows, and why. This file holds the stack and the rules every part
of the code keeps; the rest is by area:

- [data.md](data.md): data conventions, tenancy, schema and migrations, time zones, and
  working days
- [auth.md](auth.md): sign-in methods, cookies and consent, abuse limits, and the content
  security policy
- [platform.md](platform.md): supported browsers, deployment, environments,
  internationalization, error pages, and the performance harnesses
- [reports.md](reports.md): report export, entries, views, and ticket keys
- [timer.md](timer.md): the timer calendar, date and time fields, and user settings
- [scene.md](scene.md): the seasonal scene, its glass, weather, and intro
- [taglines.md](taglines.md): the page tagline and how it picks its lines

## Stack

| Concern       | Choice                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework     | TanStack Start with Solid on Nitro: its Vercel preset on Vercel, its `bun` preset self-hosted (`docs/deployment/README.md`)                                                                                                      |
| Runtime / PM  | Bun for installs, scripts, and tests; Vercel functions run on Node, a self-hosted server on Bun. `packageManager` in `package.json` pins the Bun version, which CI (`setup-bun`) and the `vercel.json` install command both read |
| Database      | Turso (libSQL/SQLite) via `@libsql/client`; self-hosted, a local file in the app's process                                                                                                                                       |
| ORM           | Drizzle v1 (pinned rc), `"turso"` dialect; query layer only                                                                                                                                                                      |
| Migrations    | Hand-written SQL, applied by `drizzle-kit migrate`                                                                                                                                                                               |
| Auth          | Better Auth with the Drizzle adapter; organization plugin without teams (organization deletion disabled); teams are app rules                                                                                                    |
| Data fetching | TanStack Query with optimistic updates                                                                                                                                                                                           |
| Forms         | TanStack Form                                                                                                                                                                                                                    |
| Validation    | Valibot, shared by forms and the JSON API's input and output schemas                                                                                                                                                             |
| UI            | Solid-UI + Tailwind; components in `src/components/ui/`, copied from the Solid-UI registry at the commit the prototypes use (`21ba4fa`)                                                                                          |
| i18n          | English and Estonian; Paraglide JS                                                                                                                                                                                               |
| Testing       | `bun test` for server and database code (`*.test.ts`); Vitest with Solid Testing Library in jsdom for components (`*.test.tsx`); `bunfig.toml` and `vitest.config.ts` keep each runner off the other's files                     |
| Lint          | oxlint with type-aware rules (`oxlint-tsgolint`) and `eslint-plugin-solid` as a JS plugin; config in `.oxlintrc.json`, warnings fail                                                                                             |
| Format        | oxfmt (Prettier-compatible; the project uses no Prettier); config in `.oxfmtrc.json`; prototypes and generated files are skipped                                                                                                 |
| Spreadsheets  | `write-excel-file` (MIT, write-only, one dependency: fflate) for the report's XLSX export, loaded in the browser only when someone exports; CSV is built without a library (see "Report export" in [reports.md](reports.md))     |
| Client state  | No library; Solid signals/stores and URL search params; user settings on the server (see "User settings" in [timer.md](timer.md))                                                                                                |

## Application rules

- All DB access goes through the JSON API (`/api/v1`, task 084); the Turso token never
  reaches the browser. The browser calls it over HTTP, and Start's server render calls the
  same handlers in process, so a page load makes no HTTP request to itself. A GET only
  reads: a read that needs state works it out, and only an explicit write saves it.
  Better Auth's sliding session, which may send its cookie again, is the one exception.
- Authorization checks live in the rules the API's handlers call (SQLite has no RLS).
- Writes are named mutations (`startTimer`, `stopTimer`, `updateEntry`, …),
  not generic CRUD.
- The UI applies writes optimistically. `optimistic` in `src/lib/queries/query.ts` updates
  every cache a mutation touches before the server answers, restores them on error, and
  refetches either way; the view then shows the error's message. The timer
  (`src/features/timer/queries.ts`) sets the pattern: starting a timer updates both the
  running timer and the entry lists. A view checks for a refusal it can predict before it
  writes: `listProjects` says which projects have live time entries, so deleting one of those
  offers archiving without a call. A delete the server refuses anyway, because an entry was
  logged after the list loaded, brings the row back and shows the error.
  - An optimistic change goes only into the caches it belongs in: a new entry joins the
    lists of its organization, user, and days, and a stopped timer ends where the server
    will end it, at most 24 hours after its start.
  - A write also marks stale the caches it changes but can't update, through
    `optimistic`'s `invalidate`. Every timer write, and every change to who is in a team,
    marks the reports stale (`reportsKey`), so Reports and the Projects view's totals
    load again when they open, even within their 30-second stale time.
- Components read queries through `useQuery` in `src/lib/queries/use-query.ts`, not Solid
  Query's, and oxlint enforces it. Solid Query's hook passes every cache update through a
  Solid resource, which puts the nearest `Suspense` boundary back in its fallback for a
  moment. The page's nodes leave the document and come back, so a field loses focus and a
  scrolled list jumps after each write (task 070, TanStack/query#9955, open on 2026-09-29).
  Our hook writes the observer's results into a store and never suspends. The route loaders
  fetch what a page shows, on the server and in the browser, and a query without a loader
  reads as pending until it loads. The project doesn't patch Solid Query. Once a fix such as
  TanStack/query#11230 is released, the hook can go.
- The query cache holds one user's data (`src/lib/queries/session.ts`), each organization's
  under its own keys ("Tenancy" in [data.md](data.md)). Signing out opens the sign-in page as
  a new page load, with an empty cache. When the session query returns another user, because
  of a sign-out elsewhere or an expired session, every other query resets: projects, teams,
  members, and reports are keyed by organization but hold what the user may see.
- Business logic lives in TypeScript, not DB triggers. Two trigger kinds are allowed:
  the `updated_at` safety net above, which is bookkeeping, and a guard for a rule that
  concurrent requests could break between the server's check and its write, where a
  `CHECK` would need a table rebuild (`time_entry_max_length`,
  `time_entry_live_project`, `project_deleted_with_entries`). The server still checks
  first, so the usual refusal has its own message, and maps a guard's failure to the
  same error.
- Queries on soft-deleted tables filter `sys_deleted = 0` through shared
  helpers, not ad hoc in each rule.
- On Vercel each statement is an HTTP round trip to Turso, so a rule runs
  statements that don't depend on each other together. Outside a transaction,
  `Promise.all` sends them as parallel requests. Inside one, libSQL sends statements
  issued in the same tick as one pipeline request. Checks that throw go through
  `allInOrder` (`queries.server.ts`), which reports the first failure in list order, so
  the error doesn't depend on which request answers first. In `startTimer`, the stop of
  the running timer goes with the checks, because a failed check rolls it back.
- Server code is grouped by domain: `auth`, `entries`, `timer`, `projects`, `reports`,
  `teams`, and `settings`, each in `src/server/<domain>/`. A domain folder holds:
  - `<domain>.server.ts`: server-only modules holding the rules. They take the database
    and scope as arguments, so tests run them against seeded throwaway databases.
    TanStack Start's import protection keeps `*.server.*` files out of the client
    bundle. The auth domain also holds the Better Auth instance
    (`better-auth.server.ts`).
  - `<domain>.schemas.ts`: the Valibot schemas of the domain's calls, what they take and
    what they send, shared by forms, the API, and the client. They must stay importable
    from the browser. A domain that needs another's schema imports that domain's file.
    `src/lib/api/operations.ts` lists each call's method, path, scope, input, and output.
  - `<domain>.test.ts`: tests of the rules.
- Code that several domains share sits directly in `src/server/`:
  - `operations.server.ts`: each call's handler, which calls the domain's rules the way
    its route would. `runOperation` resolves the call's scope (organization, user, or
    public, for the signed-out calls), validates its input, and turns a refusal into the
    contract's answer. An organization call names `organizationId` and gets the tenancy
    scope of that organization ("Tenancy" in [data.md](data.md)).
  - `api.server.ts`: the JSON API over HTTP, and `renderTransport`, which Start's server
    render calls in process. Both check the session in `guards.server.ts`, run the call
    inside `withActor()`, and count a write against the user's rate. Writes need the
    app's own `Origin`. A read whose input is a filter object, as the reports' are, is a
    POST marked `read` in the operation list, so its filters travel as a JSON body; it
    passes the checks a GET does.
  - `scope.server.ts`, `queries.server.ts`, and `testing.ts`: the tenancy scope, the
    shared query helpers, and the seeded test databases.
  - `schemas.ts`: Valibot building blocks (`Uuidv7`, `Description`, `Timestamp`,
    `OrgRole`) for the domain schemas, `OrganizationInput`, which `runOperation` checks,
    and the `Operation` type.
  - `errors.ts`: `AppError`, thrown with a code (`FORBIDDEN`, `NOT_FOUND`, and so on).
    The API sends its code and key, with an HTTP status from the code, and the client's
    transport throws it again. Better Auth's own refusals keep Better Auth's status and
    code. A serialization adapter in `src/start.ts` keeps an `AppError` that a loader
    throws during the server render; Start would otherwise send only the message.
- The client imports a domain's `*.schemas.ts`, `schemas.ts`, and `errors.ts`: that is
  the backend's contract. It never imports `*.server.ts`, even for a type. Queries and
  mutations call `call` in `src/lib/api/client.ts`, whose transport is the JSON API over
  HTTP in the browser, and the API in process during a server render
  (`src/server-entry.ts` sets it). Both decode answers with the output schemas
  (`src/lib/api/wire.ts`), so the cache holds the same `Date`s and `AppError`s either
  way, and the handlers' return types are checked against the same schemas. Code the
  client and server share that isn't part of the contract, such as `calendar.ts`, lives
  in `src/lib/`.
- One folder per domain replaced parallel `src/functions/`, `src/schemas/`, and
  `src/server/` trees, in which one change to a domain touched three folders. The
  separate route, service, and DAO layers of minupatsient-api were not adopted: one
  handler per call is the route, and one rules module per domain is tested directly, so
  the extra layers would mostly pass calls through.

## Deferred / out of scope

- Local-first sync. If ever needed: Turso's own embedded replicas/sync.
  Postgres-based sync engines (Zero, ElectricSQL) are not compatible with
  Turso.
- Neon/Postgres remains the fallback if SQLite's time zone and reporting
  limits become a problem.
