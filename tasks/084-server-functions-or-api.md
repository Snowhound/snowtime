# 084: Server functions or one JSON API

Status: todo

The native backend can't serve Start's server functions, so it serves a JSON API (task
081.02). If server functions save the TypeScript app little, the TypeScript backend serves
the same API, and both deployments share one client, one contract, and one set of
conformance tests. This task measures what server functions save and recommends one way.

## To measure

On the same build and database (Lumen Works, `perf:load` and task 078's harness), a
server function against a Start server route that returns the same data as JSON, for
the hot reads and writes: session, running timer, entries, projects, start, stop, and the
week report.

- Server CPU per call and per action, and latency p50 and p95 under task 078's usage model
- Bytes on the wire, compressed, and the client's decode time for the largest responses
- The client bundle with and without Start's server function runtime
- What server functions give besides speed: types end to end, Start's serialization of
  `Date`, `Map`, and `AppError`, middleware, and CSRF. What the API needs instead.

## Acceptance criteria

- [ ] The numbers above, recorded in this task
- [ ] A recommendation, agreed with Kait: keep server functions in the TypeScript app, or
      move it to the API of task 081.02
- [ ] If the API: the migration plan and its order, so the app works at every step
