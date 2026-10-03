# 084: From server functions to one JSON API

Status: done

The TypeScript app moves fully to the JSON API of task 081.02, and Start's server
functions go (Kait, 2026-10-03). The timer's measurements below showed the API no slower
and its responses smaller, and the schemas, the shared checks, and the API's encoding now
give what server functions gave: types end to end, `Date` and `AppError` across the wire,
middleware, and CSRF. Keeping them would mean binding every call twice and following
Start's private protocol, which the native backend can't serve.

Earlier the same day Kait chose to keep server functions behind the client module and
switch once the API cost little; the measurements settled that. The seam below was built
for that plan and carries the move.

## Design

- **One client module, three implementations.** Query and mutation functions call the
  client module, not `*.functions.ts`. Its server-function implementation serves the
  TypeScript app, in the browser and in Start's server render. Its HTTP implementation
  calls the API from the browser when the native backend serves the page. Its host-call
  implementation runs in the native backend's render isolate (task 081.01). All three
  give the query cache the same shapes: a `Date` stays a `Date`, and a thrown `AppError`
  keeps its code and key. No response holds a `Map` or a `Set`; none does today.
- **Rules shaped `(db, scope, input)`.** The rules in `*.server.ts` are the contract's
  logic. Server functions and the API's routes both call them, and the Rust handlers port
  them. The running timer spans organizations, so its rules take the user's ID, not a
  scope.
- **Output schemas.** Valibot schemas in `*.schemas.ts` describe each response. Dates go
  over the wire as ISO 8601 strings, and the HTTP implementation decodes them with the
  output schemas (Kait, 2026-10-03). The same schemas check the TypeScript rules' return
  types and the conformance tests' responses.
- **The API in every build.** The TypeScript app serves the timer's `/api/v1` routes on
  Vercel too, as Start server routes over the same rules (Kait, 2026-10-03). Its client
  keeps calling server functions. The conformance tests run against the API over HTTP, so
  one suite checks both backends.

## To measure

Kait chose these on 2026-10-03, because they inform the seam or a later switch. On the
same build and database (Lumen Works, `perf:load`):

- **API against server functions.** Server CPU per call, and latency p50 and p95, for the
  timer's calls: running timer, entries, start, and stop. This tells whether a switch
  costs little.
- **The codec on the largest timer read.** Compressed bytes and the client's decode time,
  Start's serialization against JSON with the output schemas' `Date` decoding. This tells
  whether the timer's API needs more than plain JSON.
- **Hydration equality.** A test, not a timing: the cache a server render dehydrates
  equals what the HTTP implementation decodes for the same read.

Dropped, because they don't change the decision: the client bundle without Start's server
function runtime, the week report and the other hot reads beyond the timer, and a written
comparison of middleware and CSRF, which the design above answers.

## The seam

- `src/lib/api/client.ts`: `call(name, input)`, the one entry point, and `setTransport`.
  The browser keeps the default, `httpTransport`. `src/server-entry.ts` sets
  `renderTransport` (`src/server/api.server.ts`) for Start's server render: the host
  transport over the API's own handler, for the page's request, so a loader's read makes
  no HTTP request.
- `src/lib/api/transports.ts`: `httpTransport` for the browser, and `hostTransport` for a
  server render, in Start or in the native backend's render isolate. The host implements
  one function, `call(name, input) → { status, body }`, with `input` and `body` as the JSON
  the API takes and sends. Rust answers it by running the API's handler for the page's own
  session.
- `src/lib/api/wire.ts`: the encoding both share. A GET sends its input as the query
  string, any other call as a JSON body, and the IDs in the path. The schemas turn
  dates, and a GET's booleans, back into their types. A refusal is `{ error: { code, key } }`
  with an HTTP status from the code (401, 403, 404, 409, 422, 429, 503); input that fails a
  schema is a 400 with a message; Better Auth's refusals keep its status and code.
- `src/server/operations.server.ts`: each call's handler, with JSON in and out, for an
  organization, the signed-in user, or anyone (`public`). `api.server.ts` adds the
  session, the write rate limit, the `Origin` check on writes against `BETTER_AUTH_URL`,
  and the availability probe (`guards.server.ts`).
- `src/lib/api/operations.ts` lists the calls: method, path, scope, and input and output
  schemas, which sit in the domains' `*.schemas.ts`. The browser's transport imports the
  list. The rules return only the contract's fields, not the audit columns.
- Tests: `src/server/operations.test.ts` (hydration equality: the server render's
  transport against `httpTransport`), `src/lib/api/transports.test.ts` (the HTTP
  encoding), and `conformance/` (43 tests over HTTP, one file per domain,
  `bun run test:conformance`, any backend through `CONFORMANCE_URL`).

## Measured

`bun run perf:api` on 2026-10-03 (removed with the timer's server functions; see git): the production build under Bun 1.4.2 on an Apple M1
Pro, Lumen Works seed. Of the two runs with the final harness, the second is below; their
p50s and CPU at 10 agreed within 0.1 ms, and the writes' p95 varied by up to 1.3 ms.

| Call                     | Through         |          p50 |          p95 | CPU/call | Calls/s at 10 | CPU/call at 10 |
| ------------------------ | --------------- | -----------: | -----------: | -------: | ------------: | -------------: |
| Running timer            | Server function |       0.7 ms |       1.4 ms |   1.3 ms |         2,866 |         0.4 ms |
| Running timer            | JSON API        |       0.5 ms |       0.7 ms |   0.4 ms |         2,970 |         0.4 ms |
| Own entries, 14 days     | Server function |       0.7 ms |       1.0 ms |   0.8 ms |         2,029 |         0.5 ms |
| Own entries, 14 days     | JSON API        |       0.6 ms |       0.8 ms |   0.5 ms |         2,279 |         0.5 ms |
| Start, then stop (pairs) | Server function | 1.5 / 1.0 ms | 2.2 / 1.1 ms |   1.2 ms |               |                |
| Start, then stop (pairs) | JSON API        | 1.7 / 1.1 ms | 2.3 / 2.5 ms |   1.4 ms |               |                |

| Read                 | Through         |    Bytes | Gzipped | Decode p50 in Chrome |
| -------------------- | --------------- | -------: | ------: | -------------------: |
| Own entries, 14 days | Server function |  23.8 KB |  2.3 KB |               0.1 ms |
| Own entries, 14 days | JSON API        |  16.0 KB |  1.7 KB |               0.1 ms |
| Own entries, 93 days | Server function | 151.6 KB | 11.8 KB |               0.5 ms |
| Own entries, 93 days | JSON API        | 104.9 KB |  8.3 KB |               0.4 ms |

- The API costs no more than server functions. Under load both use the same CPU per read.
  One call at a time, the API answers 0.1–0.2 ms sooner. The server functions' CPU per
  sequential call exceeds their latency, so it includes work on Bun's other threads; it
  isn't a cost per call to rely on. The writes are equal within the runs' spread. Start's protocol sends 1.4× the bytes,
  gzipped, because seroval tags every value.
- The timer's API needs plain JSON. Decoding 93 days of entries with the output schemas
  takes 0.4 ms in Chrome, against 0.5 ms for Start's decoder.
- Hydration stays the same: the test above passes for the running timer, a range of
  entries with a running one, a date alone, and a refusal.

## After the move

`bun run perf:load` and `bun run perf:pages` on 2026-10-03, `081-server-rendering`
(`183015c`, server functions) against this branch (the API), alternated A, B, B, A on one
machine. Each cell is the two runs' values.

| Server render, per request |           Server functions |                        API |
| -------------------------- | -------------------------: | -------------------------: |
| Timer p50 / CPU            | 18.3, 18.4 / 29.3, 28.7 ms | 16.6, 16.6 / 26.7, 26.0 ms |
| Reports, week p50 / CPU    | 15.8, 14.4 / 16.7, 15.7 ms | 12.8, 13.1 / 15.3, 13.7 ms |
| Reports, year p50 / CPU    | 43.6, 43.9 / 47.0, 47.0 ms | 42.5, 43.4 / 46.3, 49.3 ms |
| Settings p50 / CPU         | 14.1, 14.2 / 15.7, 15.7 ms | 19.2, 12.1 / 17.0, 12.7 ms |

| Browser, 4x CPU, Fast 4G            | Server functions |           API |
| ----------------------------------- | ---------------: | ------------: |
| Timer HTML, gzipped                 |          18.3 KB |       17.9 KB |
| Reports (week) HTML, gzipped        |          17.8 KB |       17.5 KB |
| JS per page, gzipped                |   +0.9 to 1.1 KB |      baseline |
| Timer, cold load to ready           |    2370, 2385 ms | 2288, 2291 ms |
| Reports (week), cold load to ready  |    2163, 2207 ms | 2122, 2115 ms |
| Reports, previous range to new data |        41, 39 ms |     48, 46 ms |

- The server render is as fast or faster: the timer page takes about 1.7 ms and 2.5 ms of CPU
  less per request, and the week report about 2 ms less. The in-process transport repeats the
  scope lookup per loader, and that doesn't show. Settings' first API run is an outlier; its
  second is faster than both server-function runs.
- Pages are smaller: the client no longer loads Start's server-function runtime, and the
  server-rendered HTML shrank by 2 to 4%, for a reason not yet traced.
- One step is slower: a report refetch in the browser takes about 7 ms more to new data.
  Decoding the report with its output schema is the likely cause, not yet confirmed. It is
  the one number to watch.

## The full move

Speed is not a reason to stay on server functions, so the move is only work:

- **Transferability first.** Each of the 41 server functions is checked as task 085
  describes and gets a verdict: transferable, transferable with changes, or not as is.
  The report is the first commit.
- **Every call on the contract:** its output schema, its operation, its handler, its
  `/api/v1` route, and conformance tests, one domain per commit.
- **An in-process transport for Start's server render,** running `runOperation` for the
  page's session, as the native backend's host does, so a page load makes no HTTP request
  to itself. The browser uses `httpTransport`. The hydration test covers both.
- **A GET only reads** (Kait, 2026-10-03). A read works out what it needs, and only an
  explicit write saves it:
  - The session read returns the fallback active organization without saving it. Only
    switching organizations saves it, through Better Auth's own call. Check first that
    nothing relies on the saved value being repaired.
  - The session read no longer sets the language cookie. Saving the language setting and
    signing in set it. When the account's language differs from the page's, the browser
    sets its cookie and loads the page again, as it does now.
  - `getSettings` no longer creates the settings row. The read returns none, and the
    client creates the row with an idempotent `PUT /api/v1/settings` carrying the
    browser's time zone and language.
  - Better Auth's session check may extend the session and send its cookie again. That
    sliding expiry is the auth library's, not the app's data, and stays; the native
    backend must do the same.
- **Server functions deleted last,** with `src/start.ts`'s serialization adapter and
  CSRF middleware if nothing else needs them.

## Transferability

Checked on 2026-10-03 as task 085 describes. The app has 41 server functions in 9
`*.functions.ts` files (tasks 081.02 and 085 counted 50). Of them, 32 are
transferable, 9 are transferable with changes, and none is not transferable as is:
nothing streams, returns a raw `Response`, or takes `FormData`, and the export already
comes in month-sized JSON pieces.

Some transferable functions need the seam to handle what the timer's 8 calls didn't.
These changes go in `src/lib/api/` and `operations.server.ts` once, not in the functions:

- **A: Read input beyond strings and dates.** `wire.ts` sends a GET's input as
  `URLSearchParams`, so every value arrives as a string, and the server's `decode` only
  revives dates. `listProjects` takes a boolean, and the report reads take the report's
  filters, with nested objects (`report`, `row`, `after`) and numbers. The other reads
  stay GET, and `decode` reads a boolean query value (`includeArchived=true`) by the
  schema as it revives dates. Kait first chose HTTP `QUERY`, a read with a JSON body, for
  the report reads. Vercel's edge refuses it: a preview answered `405` with
  `x-vercel-error: INVALID_REQUEST_METHOD` on 2026-10-03, before the function ran. Kait
  then chose POST over JSON in the query string, the agreed fallback, which reads badly in
  URLs and logs: the report reads are POSTs marked `read` in the operation list, so the
  API skips the `Origin` check and the write rate limit for them, as for a GET.
- **B: Signed-out calls.** `runOperation` assumes a signed-in user. Six calls run without
  one, so the contract gains a third scope, `public`, whose handler gets the session or
  `null`.
- **C: Better Auth calls.** `inviteMember` and `acceptInvitation` call Better Auth's
  server API with the request's headers, so their handlers take the caller's headers, and
  the in-process transport passes the page's.

| Function                  | Verdict      | Proposed call                                | Notes |
| ------------------------- | ------------ | -------------------------------------------- | ----- |
| Timer (3), entries (5)    | Transferable | On the contract already                      |       |
| `listProjects`            | With changes | `GET …/projects`                             | 1, A  |
| `createProject`           | With changes | `POST …/projects`                            | 1     |
| `updateProject`           | With changes | `PATCH …/projects/:id`                       | 1     |
| `archiveProject`          | With changes | `POST …/projects/:id/archive`                | 1     |
| `unarchiveProject`        | With changes | `POST …/projects/:id/unarchive`              | 1     |
| `deleteProject`           | Transferable | `DELETE …/projects/:id`                      |       |
| `assignProjectToTeam`     | Transferable | `PUT …/projects/:projectId/teams/:teamId`    |       |
| `unassignProjectFromTeam` | Transferable | `DELETE …/projects/:projectId/teams/:teamId` |       |
| `listTeams`               | Transferable | `GET …/teams`                                |       |
| `createTeam`              | Transferable | `POST …/teams`                               |       |
| `renameTeam`              | Transferable | `PATCH …/teams/:teamId`                      |       |
| `deleteTeam`              | Transferable | `DELETE …/teams/:teamId`                     |       |
| `addTeamMember`           | Transferable | `PUT …/teams/:teamId/members/:userId`        |       |
| `removeTeamMember`        | Transferable | `DELETE …/teams/:teamId/members/:userId`     |       |
| `setTeamRole`             | Transferable | `PATCH …/teams/:teamId/members/:userId`      |       |
| `listMembers`             | Transferable | `GET …/members`                              |       |
| `getReport`               | Transferable | `POST …/report`                              | A     |
| `getReportBreakdown`      | Transferable | `POST …/report/breakdown`                    | A     |
| `getReportEntries`        | Transferable | `POST …/report/entries`                      | A     |
| `getReportEntryTotals`    | Transferable | `POST …/report/entry-totals`                 | A     |
| `getReportExport`         | Transferable | `POST …/report/export`                       | A     |
| `updateIssueLinks`        | Transferable | `PATCH …/issue-links`                        |       |
| `listInvitations`         | Transferable | `GET …/invitations`                          |       |
| `inviteMember`            | With changes | `POST …/invitations`                         | 2, C  |
| `acceptInvitation`        | With changes | `POST /api/v1/invitations/:id/accept`        | 2, C  |
| `getInvitation`           | Transferable | `GET /api/v1/invitations/:id`                | B     |
| `getSettings`             | With changes | `PUT /api/v1/settings`                       | 3     |
| `updateSettings`          | Transferable | `PATCH /api/v1/settings`                     |       |
| `getAppSession`           | With changes | `GET /api/v1/session`                        | 4, B  |
| `getSignInMethods`        | Transferable | `GET /api/v1/sign-in-methods`                | B     |
| `getDeployment`           | Transferable | `GET /api/v1/deployment`                     | B     |
| `getDevUsers`             | Transferable | `GET /api/v1/dev-users`                      | B     |
| `checkAvailability`       | Transferable | `GET /api/v1/availability`                   | B     |

`…` stands for `/api/v1/organizations/:organizationId`. `checkAvailability` reads no
session, because it answers while the database is down.

The changes:

1. **Projects return their audit columns.** `listProjects` selects
   `getTableColumns(project)`, and the writes use a bare `.returning()`, so responses carry
   `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, and `sysDeleted`. They return the
   contract's fields only, as the entries' rules do, plus `hasEntries` and `teamIds` on the
   list.
2. **Invitations send Better Auth's refusals as successes.** `authResult` turns Better
   Auth's `APIError` into `{ data: null, error: { code, status } }`, which the client's
   `unwrap` throws, as with Better Auth's client calls. `inviteMember` also returns Better
   Auth's whole invitation, of which the client reads `id`, `email`, and `expiresAt`; its
   output narrows to those. How the refusal travels is under Kait's answers below.
3. **`getSettings` is a GET that creates the row.** Its only caller is the app frame,
   which creates a new user's settings from the browser's time zone and language; the
   session read carries the settings. It becomes `PUT /api/v1/settings`, which inserts the
   row if it is missing and returns it. No settings GET remains.
4. **`getAppSession` writes and reads the request.** It saves the fallback active
   organization through `auth.api.setActiveOrganization`, sets the language cookie, and
   compares the account's language with `getLocale()`, the page's. As decided above, it
   returns the fallback without saving it and sets no cookie. `localeChanged` leaves the
   response: the root route compares `settings.locale` with its own `getLocale()`, and
   then redirects on the server or sets the cookie and reloads in the browser, as now. Its
   handler needs the session itself (the user and `createdAt`), which scope B gives.
   `defaultOrganization` already reads the returned fallback, not the saved one; the port
   checks the other readers of `activeOrganizationId`.

`middleware.ts` cached scopes per request, so a server render's parallel loaders shared
one lookup. `runOperation` resolves the scope per call, so the in-process transport
repeats that indexed read once per loader. The transport keeps no cache: under
"After the move", the server render is as fast or faster than with server functions.

### Kait's answers

Kait agreed on 2026-10-03:

- **Better Auth's refusals (2).** The API answers with Better Auth's status and
  `{ error: { code, message } }` carrying Better Auth's code, the shape Better Auth's own
  HTTP API sends. The transport throws it as `{ code, status }`, so the client's messages
  for Better Auth codes keep working. Rejected: `{ data, error }` in a 200, which hides a
  refusal from the status and from the conformance tests.
- **The paths in the table**, with organization calls under
  `/organizations/:organizationId` as the entries are.

## Acceptance criteria

- [x] The client module with server-function and HTTP implementations, and the timer's
      reads and writes calling it, with query keys, cached shapes, and components
      unchanged
- [x] The host-call implementation's interface written down for task 081.01's isolate
- [x] Output schemas for the timer's responses, checked against the rules' return types
- [x] The timer's `/api/v1` routes in the TypeScript app, and conformance tests that pass
      against them over HTTP
- [x] The hydration equality test
- [x] The measurements above, recorded in this task, with the condition for a switch
- [x] The transferability report for all 41 server functions
- [x] Every call on the contract, with conformance tests, and no `createServerFn` left
- [x] The in-process transport for Start's server render, with the hydration test
      covering it and the HTTP transport
- [x] No GET that writes, except Better Auth's sliding session
- [x] `docs/architecture/` and `AGENTS.md` describe the API instead of server functions
