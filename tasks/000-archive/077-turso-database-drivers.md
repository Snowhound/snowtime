# 077: Turso's own database drivers

Status: done

Drizzle has drivers for Turso's rewrite of SQLite (Turso Database) besides libSQL. Two might
have suited Snowtime better than `@libsql/client`: `@tursodatabase/database` for a local
file and `@tursodatabase/serverless`, a fetch-based client, for Vercel. Neither was adopted
on 2026-09-30; the measurements and reasons are in `docs/architecture/platform.md`,
"Environments and deployment". The app code stayed on `@libsql/client`. The review of
round trips that came with this task parallelized independent statements in `appSession`,
`startTimer`, `createEntry`, `updateEntry`, `listProjects`, and the project-team writes.

## Acceptance criteria

- [x] Local driver: compared with libSQL `file:` on a copy of the benchmark database. Year
      reports ran about 40% faster (36 against 58 ms); the rest were even. `bun test` and
      `perf:load` weren't run on it, because the file sharing below ruled it out first.
- [x] Local driver: task 043's repro no longer loses the write, and the busy wait doesn't
      block the process
- [x] Serverless driver: gaps listed (a `describe` per query, one queue per instance,
      transactions open to other requests' statements, expired streams after about 10 idle
      seconds). Measured against a local `sqld` with added latency, not a Vercel preview:
      `staging` doesn't exist yet.
- [x] Foreign keys: the libSQL server enforces them by default, so the serverless client
      gets them; the local engine needs `PRAGMA foreign_keys = ON`
- [x] Kait decided to keep `@libsql/client` for both deployments, recorded in
      `docs/architecture/platform.md`
