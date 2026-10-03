# 084: Server functions and the API behind one client

Status: done

The TypeScript app keeps Start's server functions, and the native backend serves the JSON
API of task 081.02. The frontend reaches either through one client module (Kait,
2026-10-03). The app moves to the API only once that costs little and hydration stays the
same. This task designs the seam, proves it on the timer's reads and writes, and measures
what tells when a switch would cost little.

Rejected for now: moving the TypeScript app to the API, which this task first set out to
decide. Server functions give types end to end, Start's serialization of `Date` and
`AppError`, middleware, and CSRF with no code in the app. Giving them up buys nothing
until the native backend exists.

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
  The TypeScript app keeps the default, `serverFunctions` (`server-functions.ts`), whose
  map from operation to server function type-checks every rule's return type against its
  output schema.
- `src/lib/api/transports.ts`: `httpTransport` for the browser on the native backend, and
  `hostTransport` for its render isolate. The host implements one function,
  `call(name, input) → { status, body }`, with `input` and `body` as the JSON the API
  takes and sends. Rust answers it by running the API's handler for the page's own
  session, so a loader's read makes no HTTP request.
- `src/lib/api/wire.ts`: the encoding both share. A GET sends its input as the query
  string, a write as a JSON body, and the IDs in the path. A refusal is
  `{ error: { code, key } }` with an HTTP status from the code (401, 403, 404, 409, 422,
  429, 503); input that fails a schema is a 400 with a message.
- `src/server/operations.server.ts`: each operation run against its rule, for a signed-in
  user, with JSON in and out. `api.server.ts` adds the session, the write rate limit, the
  `Origin` check against `BETTER_AUTH_URL`, and the availability probe, which it shares
  with the middleware through `guards.server.ts`.
- The operations (`timerOperations`, `entriesOperations`) sit in the domains'
  `*.schemas.ts`, beside the output schemas `Entry` and `RunningTimer`. The rules now
  return only the contract's fields, not the audit columns, so both transports send the
  same entry.
- Tests: `src/server/operations.test.ts` (hydration equality),
  `src/lib/api/transports.test.ts` (the HTTP encoding), and `conformance/` (13 tests over
  HTTP, `bun run test:conformance`, any backend through `CONFORMANCE_URL`).

## Measured

`bun run perf:api` on 2026-10-03: the production build under Bun 1.4.2 on an Apple M1
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

## When to switch

Speed is not a reason to stay on server functions, so the switch waits only on work. The
TypeScript app can drop server functions once every call is on the contract: its output
schema, its operation, and its handler, as the timer's eight are now (42 server
functions remain). Its server render then needs an in-process transport like the host's,
running `runOperation` for the page's session, so a page load makes no HTTP request to
itself. Until then, a domain moves to the contract when the native backend needs it.

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
