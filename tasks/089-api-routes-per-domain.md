# 089: API routes and client per domain

Status: done

Replace the central call table with per-domain routes on the server and per-domain
functions on the client. Today `src/lib/api/operations.ts` (396 lines, 41 calls) gives each
call a name, method, path, scope, `read` flag, and input and output schemas. Every call is
also listed in `src/server/operations.server.ts`, and `src/server/api.server.ts` matches
each request against the table. Task 084 needed the table to replace server functions.
Now it does five jobs at once:

- Call names exist only inside TypeScript. The native backend (task 081) routes by method
  and path, and the server render calls by name only because `api.server.ts` dispatches by
  name.
- One file imports every domain's schemas, so they all reach the client bundle, and
  server-only policy (`scope`, `read`) ships to the browser.
- The browser validates every response with `v.parse` (`resultOf` in
  `src/lib/api/wire.ts`), including the 1.66 MB of a 92-day `listEntries`, mainly to turn
  date strings back into `Date`.
- Go to definition from `call('updateEntry', ...)` lands in a table, and the handler is in
  a second table.

The usual layout for a non-TypeScript backend with a TypeScript frontend is per-domain
server routes and per-domain client modules, with server rendering calling the API in
process by URL. SvelteKit's `event.fetch` works this way. The native backend will use the
same layout with Axum (task 081.06), so each domain's routes file has a counterpart in
Rust. Kait decided on this on 2026-10-04. OpenAPI generated from the server stays a later
option, not part of this task.

## Design

- **Server: Hono routers per domain**, mounted in the existing catch-all
  `src/routes/api/v1/$.ts`. Use only Hono's router and middleware, not its RPC client
  (`hc`). Each domain gets a `<domain>.routes.ts` beside its `<domain>.server.ts`:

  ```ts
  // src/server/entries/entries.routes.ts
  export const entryRoutes = new Hono<Env>()
    .get('/entries', input(ListEntriesInput), (c) => run(c, entries.listEntries))
    .get('/entries/first-start', input(GetFirstEntryStartInput), (c) =>
      run(c, entries.getFirstEntryStart),
    )
    .post('/entries', input(CreateEntryInput), (c) => run(c, entries.createEntry))
    .patch('/entries/:id', input(UpdateEntryInput), (c) => run(c, entries.updateEntry))
    .delete('/entries/:id', input(DeleteEntryInput), (c) => run(c, entries.deleteEntry))
  ```

  Organization-scoped routers are mounted under `/api/v1/organizations/:organizationId`
  behind a middleware that resolves the scope. User-scoped and public routes are mounted
  without it. Each handler stays one line that calls its rule.

- **Shared steps live in middleware and two helpers.** What `api.server.ts` and
  `guards.server.ts` do now is kept, with the same behavior:
  - the Origin check on writes, against the public URL and not the request's own;
  - the session, and the write rate limit;
  - `withActor`;
  - Server-Timing (task 088);
  - the database-unavailable mapping;
  - the error body.

  `input(schema)` merges the path parameters with the query string of a GET or the JSON
  body, then validates the result with valibot. It answers with the same 400 and messages
  as today, so the conformance tests pass unchanged. Write it yourself, not with a Hono
  validator package, unless that package produces byte-identical errors.

  A POST that only reads (today `read: true` in the table) must still skip the Origin
  check and the write limit. Mark it on the route, for example with a `reads` middleware.

- **Client: one module per domain** in `src/lib/api/` (`entries.ts`, `projects.ts`, ...),
  with one plain function per call. Features import from it. A domain module used by only
  one feature may live in that feature instead, as AGENTS.md says.

  ```ts
  export function updateEntry({ organizationId, id, ...patch }: UpdateEntryInput) {
    return request('PATCH', `/api/v1/organizations/${organizationId}/entries/${id}`, patch, Entry)
  }
  ```

  `request(method, path, input, outputSchema)` sends the input as a query string or a JSON
  body, as `requestOf` does. It turns an error body into an `AppError` or an `Error`, as
  `resultOf` does.

- **Decoding answers.** Decide whether `request` keeps validating answers with
  `v.parse`, or only revives dates and GET booleans (the `revive` step in `wire.ts`) and
  trusts the server. Measure decode time on the 92-day `listEntries` and the report export,
  and record the choice and its reason in `docs/architecture/`.
- **Server rendering by URL.** During Start's server render, `request` calls the Hono app
  in process with `app.request(path, init)`, passing the page request's cookie. This
  replaces `renderTransport` and `hostTransport`, which call by name. The native backend's
  render isolate will hand method, path, and body to Axum's router in the same way
  (task 081.06).
- **Tests.** Component tests mock the domain module's functions (`vi.mock`), not a
  transport keyed by call name (`src/lib/api/testing.ts`). The conformance tests in
  `conformance/` call HTTP. Keep them byte-for-byte unchanged where they don't use call
  names. Where a test iterates the call table, give it an explicit list of method and path.
- **Removed:** `src/lib/api/operations.ts`, `src/server/operations.server.ts`, the name
  dispatch in `api.server.ts`, the `call` client in `src/lib/api/client.ts`,
  `hostTransport`, and `mockTransport`. Keep whatever of `wire.ts` the new `request` and
  `input` still use.

## Server structure, in the same change

These keep the TypeScript server easy to compare file for file with the Rust port:

- **Each route handler only calls its rule.** Move the logic in today's multi-line handlers
  into their domains: `getAppSession`, `getDevUsers`, `inviteMember`, and any other handler
  in `operations.server.ts` longer than one call. Most of it goes to `auth/`.
- **Better Auth stays inside `src/server/auth/`.** Only files in `auth/` import
  `better-auth`, `better-auth.server.ts`, or `sessionOf`. Today `operations.server.ts`
  imports `APIError`, `auth`, and `sessionOf`, and `guards.server.ts` imports `sessionOf`
  and `rateLimitStore`. Give `auth/` the narrow functions the rest of the server needs.
  The Rust port replaces Better Auth, so `auth/` will be the one folder whose files don't
  map one to one.
- **Keep Better Auth's cookie cache.** It costs no server memory: it's a signed
  `session_data` cookie in the browser, with a 5-minute `maxAge`. Turning it off measured
  only about 0.2 ms more session time per call on a local file. On the Vercel and Turso
  deployment, though, it saves a network round trip and billed row reads on every call.
- **`ListedProject`'s field order.** Its schema lists `teamIds` before `hasEntries`, but
  the API sends `hasEntries` first. Make the schema match what the API sends.
- **Optional:** split `src/server/reports/reports.server.ts` (756 lines) into its queries
  and its pure aggregation (`aggregate`, `dayPage`, `mergeByDescription`, ...). Do it only
  if the result reads better.

## Prove it on one domain first

Move entries first, on both the server and the client, with in-process rendering by URL.
Review that diff before moving the other domains. Kait expects it to read better. If it
doesn't, stop and record why in this task.

## Acceptance criteria

- [x] Entries moved first, and the diff reviewed
- [x] Every call served by a per-domain Hono router and reached through a per-domain client
      function; `operations.ts` and `operations.server.ts` removed
- [x] Server rendering calls the API in process by URL
- [x] The answer decoding decided with measurements, and recorded
- [x] Better Auth imported only inside `src/server/auth/`; every route handler is one call
- [x] `ListedProject`'s schema in the order the API sends
- [x] `bun run test` and the conformance tests pass, with unchanged conformance assertions
- [x] `AGENTS.md` ("Code conventions": how a new call is added, which today names
      `operations.ts` and `operations.server.ts`) and `docs/architecture/README.md`
      ("Application rules") describe the new layout: routes per domain, one-call
      handlers, client modules per domain, Better Auth only in `auth/`

## Decisions

- **Entries first, reviewed.** `entries.routes.ts` came to five route lines, each with its
  method, path, input schema, and rule, where a call used to take a 7-line table row and a
  handler in a second table. Go to definition from `updateEntry({...})` lands on a function
  that shows its path and body. The costs: each path is written in the client module and
  in the route, and only the conformance and `request` tests catch a mismatch. It read
  better, so the other domains followed.
- **Shared steps.** Hono runs middleware in the order it is added, so the public routes
  go before `signedIn` and the organization middleware before the organization routers
  (`api.server.ts`). `known`, the first middleware, finds the matched routes with
  `matchedRoutes` from `hono/route`: no matched route means 404 before any other check,
  as before, and a route marked with the `reads` middleware passes the checks a GET does.
  `run(c, rule)` calls the rule with the scope or the user and the input only. The report
  rules take an optional `now` as a fourth argument, so passing the headers there would
  have been wrong; the two calls that hand headers to Better Auth (`inviteMember`,
  `acceptInvitation`) and the public routes call their function directly.
- **Refusal order.** A request that fails more than one check may now get another of its
  refusals. `input()` reads the JSON body after the session and the scope, so a body that
  isn't JSON from a signed-out caller is a 401 now, where it was a 400.
- **No separate `organizationId` check.** The id comes from the path, which Hono never
  matches with an empty segment, so `parseOrganizationInput` and its test went.
- **Content type.** Hono answers with `application/json`, where `Response.json` sent
  `application/json;charset=utf-8`. The bodies are byte-identical: a diff of 40 answers
  from `main`'s build and this branch's, on the same seeded data, for two users, differed
  only in the server's port in `appUrl` and in this header.
- **Client modules all in `src/lib/api/`,** including those only one feature uses, such as
  `entries.ts`, so one folder lists the API as the client sees it and the conformance tests
  call the same functions by name (`conformance/server.ts`).
- **Server render.** `src/server-entry.ts` sets `request`'s sender to `api.request()` with
  the page request's cookie, so `api.server.ts` doesn't import Start. The calls count
  toward the page's `Server-Timing`, since only `handleApiRequest` starts a timer.
- **Decoding: full `v.parse`.** Measured on 2026-10-04 on the seeded company, median of 15
  runs, decode time after `JSON.parse`:

  | Answer                                     | `JSON.parse` | `v.parse` | Dates only |
  | ------------------------------------------ | -----------: | --------: | ---------: |
  | 92-day `listEntries`, 1.67 MB, Chrome      |       1.0 ms |    4.9 ms |     2.8 ms |
  | Same, Bun                                  |       1.6 ms |    4.7 ms |     2.7 ms |
  | A year's export, 12 pieces, 6.5 MB, Chrome |       5.4 ms |   24.6 ms |    14.1 ms |
  | Same, Bun                                  |       8.5 ms |   19.8 ms |    14.2 ms |

  Reviving dates only would save about 2 ms on the largest list and 10 ms over a year's
  export, spread across 12 requests. Validating keeps an answer off the contract from
  reaching a view, which matters while two backends serve the API ("Application rules" in
  `docs/architecture/README.md`).

- **Not done:** splitting `reports.server.ts` (optional). Its queries and its aggregation
  are already separate functions; moving them to two files is a pure move, better made in
  a commit of its own that `.git-blame-ignore-revs` can list.

## Out of scope

OpenAPI generation (a later option), the Hono RPC client, and any change to the `/api/v1`
paths or the JSON the API sends.
