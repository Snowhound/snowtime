# 088: Server-Timing on page responses

Status: todo

Page responses carry a `Server-Timing` header that splits the server's time into session,
database, and render, so the browser's network tab shows where a slow page spends it on
any deployment. On 2026-10-04, timed from Estonia over a reused connection, the signed-in
`/lumen/timer` took a median 103–136 ms on the internal Compose server and 133–147 ms on a
Vercel preview against staging. Neither number says how much of it is the database.

## Acceptance criteria

- [ ] Server-rendered pages send `Server-Timing` with `session`, `db`, and `render`
      durations; `db` sums the request's queries, including calls made in process
- [ ] JSON API responses send the same header for their session and database time
- [ ] The header names no tables, queries, or user data, so it can stay on in production
- [ ] The overhead is measured with `bun run perf` and stays within its budgets
- [ ] `docs/architecture/` says where the header comes from and how to read it
