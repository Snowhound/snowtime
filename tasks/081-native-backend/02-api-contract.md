# 081.02: The API contract and the frontend adapter

Status: todo

Both backends implement one JSON API over HTTP. The frontend's data layer calls one client
module, whose transports reach the API over HTTP or, during a server render, in process
(task 084). Server functions can't be the contract: Start addresses each one by a
hash of the build (`/_serverFn/<sha256>`), encodes its bodies in its own format, and
accepts calls by `Sec-Fetch-Site`, so a Rust server would have to track Start's internals
release by release. Today the app has 50 server functions in 9 `*.functions.ts` files.

## Design to confirm

- **One contract.** It starts from the public `/api/v1` that issue #2 settled on
  2026-10-01, extended with what the app needs, rather than a public API beside an
  internal one. Resources where they fit (entries, projects, teams, members, reports),
  actions where they don't (start, stop, and switch the timer). One schema defines it
  and generates the types and the validation for both backends (081 question 2). The
  large responses (report entries, the export, the year timesheet) may use columns
  instead of rows, as 081 question 2 lists.
- **The adapter.** Query and mutation functions in `src/lib/queries/` and the features
  call one client module, not `*.functions.ts`. Both backends serve the API behind it,
  and the TypeScript app drops server functions (task 084, Kait, 2026-10-03).
  Query keys and the cached data's shape stay as they are, so components don't change.
- **Server rendering calls in process.** In the native backend, the render isolate runs
  the app's own TanStack loaders (subtask 01). The adapter there calls a host function
  instead of `fetch`; Rust runs the same handler the HTTP API runs and resolves the
  loader's promise with the same JSON. The loaders keep deciding a page's reads, so a
  route change needs nothing in Rust, and the first load makes no HTTP request. On
  Vercel, the adapter runs the TypeScript handlers in process during Start's server
  render.
- **After hydration** the browser of a native backend's page calls the same API over HTTP
  and gets the same shapes, so the cache the server dehydrated stays consistent with
  later fetches.
- **Errors** keep `AppError`'s code and key (`src/server/errors.ts`) in the response body,
  so the client still tells "not found" from "forbidden" and shows the message in the
  user's language.
- **CSRF.** Both backends compare `Origin` with the public URL (`BETTER_AUTH_URL`), not
  the request's own URL (081 question 3), and the session cookie keeps Better Auth's
  default, `SameSite=Lax`.

The TypeScript app serves the contract too, in every build, so the conformance tests run
against both backends, and both deployments share one client module (task 084).

## Acceptance criteria

- [ ] The contract's format and schema tool chosen, with what was rejected
- [ ] The adapter's interface, with the in-process path for server rendering, proven in
      the spike's render bundle: a loader's read answered by the host, not a seeded cache
- [ ] The timer's reads and writes (session, running timer, start, stop, entries) on the
      contract in both backends, the TypeScript side from task 084, with the conformance tests that both pass
- [ ] The decision recorded in `docs/architecture/`
