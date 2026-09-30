# 077: Turso's own database drivers

Status: todo

Drizzle has drivers for Turso's rewrite of SQLite (Turso Database) besides libSQL. Two may
suit Snowtime better than `@libsql/client`, which it uses everywhere now
(`src/db/index.ts`):

- **Local file:** `@tursodatabase/database` with `drizzle-orm/tursodatabase/database`
  ([guide](https://orm.drizzle.team/docs/sqlite/connect-turso-database)), for the
  self-hosted server (task 075), where the database runs in the app's process. It could
  be faster than libSQL's binding. It might also remove the risk task 043 left for
  self-hosting: libSQL doesn't finalize a statement that failed with `SQLITE_BUSY`, and
  the connection's later writes are lost.
- **Serverless:** `@tursodatabase/serverless` with `drizzle-orm/tursodatabase-serverless`
  ([guide](https://orm.drizzle.team/docs/sqlite/connect-turso-serverless)), a
  fetch-based client for Turso Cloud with no native addon, for Vercel. It could start
  faster and send each query in fewer bytes. It could also let the app run on edge
  runtimes, which can't load libSQL's addon (`docs/deployment/README.md`, "Other
  targets").

Prior art: task 075's Turso Sync spike (`@tursodatabase/sync`, 2026-09-30) ran the same
engine under Bun. All migrations and the full seed applied, and report results matched
libSQL's. The engine enforces foreign keys only after `PRAGMA foreign_keys = ON` on each
connection, and the project advises independent backups until 1.0. Both Drizzle guides
install `drizzle-orm@rc`, as the app already does.

## Acceptance criteria

- [ ] Local driver: `bun test` and `perf:load` run against it on a copy of the benchmark
      database, compared with libSQL `file:` (task 075's table)
- [ ] Local driver: task 043's repro (two connections, one fails with `SQLITE_BUSY`, then
      retries its write) no longer loses the write
- [ ] Serverless driver: interactive transactions work (`startTimer` and other
      `db.transaction` callers), and so do `batch` and the migrator, or the gaps are
      listed
- [ ] Serverless driver: page timings and cold starts on a Vercel preview against
      `staging`, compared with `@libsql/client`
- [ ] Foreign keys are enforced on every connection of whichever driver is adopted
- [ ] Kait decides, per deployment, whether to switch; the decision and the reason are
      recorded in `docs/architecture/platform.md`
