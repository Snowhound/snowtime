# 084: Server functions and the API behind one client

Status: in-progress

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

## Acceptance criteria

- [ ] The client module with server-function and HTTP implementations, and the timer's
      reads and writes calling it, with query keys, cached shapes, and components
      unchanged
- [ ] The host-call implementation's interface written down for task 081.01's isolate
- [ ] Output schemas for the timer's responses, checked against the rules' return types
- [ ] The timer's `/api/v1` routes in the TypeScript app, and conformance tests that pass
      against them over HTTP
- [ ] The hydration equality test
- [ ] The measurements above, recorded in this task, with the condition for a switch
