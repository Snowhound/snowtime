# Architecture

The decisions the code follows, and why. This file holds the stack and the rules every part
of the code keeps; the rest is by area:

- [native-host.md](native-host.md): how the native backend schedules work: Tokio at
  the edge and bounded lanes behind it
- [native-rendering.md](native-rendering.md): planned rendering in the native backend
- [data.md](data.md): data conventions, tenancy, schema and migrations, time zones, and
  working days
- [auth.md](auth.md): sign-in methods, cookies and consent, abuse limits, and the content
  security policy
- [platform.md](platform.md): supported browsers, deployment, environments,
  internationalization, error pages, the performance harnesses, and Server-Timing
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
| JSON API      | Hono's router and middleware, mounted in Start's `/api/v1/$` route (task 089); not its RPC client                                                                                                                                |
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
  - Planned (task 081.17, Kait, 2026-10-06): a write the server refused before running
    it (503 with `Retry-After`) keeps its optimistic change, pending with a retry action,
    instead of restoring the caches; nothing retries a write on its own. Reads retry with
    jitter and wait at least `Retry-After`. Other errors restore the caches as above.
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
    bundle.
  - `<domain>.routes.ts`: the domain's routes, as Hono routers (task 089). Each route
    names its method, path, and input schema, and its handler is one call of its rule,
    `run(c, entries.updateEntry)`. A domain whose calls differ in scope has a router per
    scope, such as the timer's user routes and its organization route. The native
    backend's Axum routers mirror these files one to one (task 081.06).
  - `<domain>.schemas.ts`: the Valibot schemas of the domain's calls, what they take and
    what they send, shared by forms, the API, and the client. They must stay importable
    from the browser. A domain that needs another's schema imports that domain's file.
  - `<domain>.test.ts`: tests of the rules.
- The auth domain is the only one that imports Better Auth: its instance
  (`better-auth.server.ts`), and in `auth.server.ts` the few functions the rest of the
  server needs from it, such as the request's signed-in user and Better Auth's refusals.
  The Rust port replaces Better Auth, so `auth/` is the one folder whose files won't map
  one to one.
- Code that several domains share sits directly in `src/server/`:
  - `api.server.ts`: the JSON API. It mounts each domain's routers under `/api/v1`, the
    organization-scoped ones under `/organizations/:organizationId`, and serves them over
    HTTP. Start's server render calls the same app in process by URL with
    `api.request()` (`src/server-entry.ts`), with the page request's cookie.
  - `http.server.ts`: the steps every route shares. `known` answers an unknown path with
    404 before any other check, and refuses a write without the app's own `Origin`, which
    on a preview is its branch or deployment URL. `signedIn` checks the session, counts a
    write against the user's rate, and runs the rest inside `withActor()`. `organization`
    resolves the tenancy scope of the organization in the path ("Tenancy" in
    [data.md](data.md)). `input(schema)` merges the path parameters with the query string
    or JSON body and validates them, and `run` calls the rule. The error handler turns a
    refusal into the contract's answer, and an unexpected error while the database is
    unreachable into `UNAVAILABLE`. A read whose input is a filter object, as the
    reports' are, is a POST whose route is marked `reads`, so its filters travel as a JSON
    body; it passes the checks a GET does. The routes added to the app before `signedIn`,
    the public ones, need no session.
  - `scope.server.ts`, `queries.server.ts`, and `testing.ts`: the tenancy scope, the
    shared query helpers, and the seeded test databases.
  - `schemas.ts`: Valibot building blocks (`Uuidv7`, `Description`, `Timestamp`,
    `OrgRole`) for the domain schemas.
  - `errors.ts`: `AppError`, thrown with a code (`FORBIDDEN`, `NOT_FOUND`, and so on).
    The API sends its code and key, with an HTTP status from the code, and the client
    throws it again. Better Auth's own refusals keep Better Auth's status and code. A
    serialization adapter in `src/start.ts` keeps an `AppError` that a loader throws
    during the server render; Start would otherwise send only the message.
- The client imports a domain's `*.schemas.ts`, `schemas.ts`, and `errors.ts`: that is
  the backend's contract. It never imports `*.server.ts` or `*.routes.ts`, even for a
  type. Each domain has a client module in `src/lib/api/` (`entries.ts`, `projects.ts`,
  and so on) with one function per call, which names the call's method and path and its
  output schema. Queries and mutations import these functions, and component tests mock
  them with `vi.mock`. They all send through `request` (`src/lib/api/request.ts`): over
  HTTP in the browser, and to the API in process during a server render, so the cache
  holds the same `Date`s and `AppError`s either way. The paths appear in both the client
  module and the route, and nothing checks at compile time that a rule returns what the
  output schema says: the conformance tests, which call the API through the client
  modules, check both. Code the client and server share that isn't part of the contract,
  such as `calendar.ts`, lives in `src/lib/`.
- The client validates every answer against its output schema with `v.parse`, not only
  turning date strings back into `Date`s (task 089). Validating costs little: on
  2026-10-04, in Chrome on a MacBook, a 92-day `listEntries` of 1.67 MB took 4.9 ms to
  validate against 2.8 ms to revive its dates only, and a year's export of 6.5 MB in 12
  pieces 24.6 ms against 14.1 ms. In return, an answer off the contract fails at the
  client instead of in a view, which matters while two backends serve the API.
- Per-domain routers on the server and per-domain modules on the client replaced one
  table of every call (`operations.ts`, task 084), which put every domain's schemas and
  the server's scope rules in the client bundle and addressed calls by a name only
  TypeScript knew. The layout follows the usual one for a TypeScript client of another
  backend, with the server render calling the API by URL as SvelteKit's `event.fetch`
  does. The router is Hono's, without its RPC client; OpenAPI generated from the server
  remains a later option.
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
