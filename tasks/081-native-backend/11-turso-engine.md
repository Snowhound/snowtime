# 081.11: Turso's engine, its speed, and its backups

Status: todo (research; after subtask 10 measures the read pool)

The native backend uses SQLite's C library through `rusqlite`, with one writer and, from
subtask 10, a pool of readers on WAL. Self-hosted backups stay with Litestream (Kait,
2026-10-05). This subtask finds out whether [Turso's engine](https://github.com/tursodatabase/turso),
the Rust rewrite of SQLite, would make the app measurably faster, and if so, how its
databases could be backed up.

Kait, 2026-10-05: if the speed difference is significant, a good backup solution is worth
searching for. Turso Cloud is acceptable for this app. Ideally Turso works with backups to
S3, or another well-designed local solution. Otherwise the porting kit (subtask 05) can
carry two recipes, one for SQLite and one for Turso.

## Questions

1. **Speed.** Against `rusqlite` with subtask 10's read pool, on the same database and
   queries:
   - reads: the timer page's reads, the week, month, and year reports, and the entry list;
   - writes: start, stop, and edit, alone and under concurrent load, with and without
     `BEGIN CONCURRENT` (MVCC);
   - CPU per query, p95 under load, and memory per connection and in total;
   - asynchronous I/O (`io_uring` on Linux) against SQLite's blocking calls.

   Measure on Linux, since `io_uring` exists only there. Use subtask 10's harness where it
   applies, and a micro-benchmark of the hot queries where it's faster to iterate.

2. **Compatibility.**
   - Does it open this app's SQLite file, and does SQLite read the file back?
   - Does it support the app's SQL: partial indexes, check constraints, `returning`,
     `json_each`, and whatever the migrations in `drizzle/` use?
   - Do Drizzle's migrations and the native migrator (`native/crates/server/src/migrations.rs`)
     run on it?
   - What does it still mark unsupported or experimental, and does the app depend on any
     of it?

3. **Porting cost.** The `turso` crate's API is asynchronous, while the rules take a
   `rusqlite::Connection`. How much of `queries.rs`, the rules, and the host would change?
   Could one trait cover both engines without slowing down the `rusqlite` path?

4. **Backups.** For each mode the engine would run in (WAL, or MVCC with its own log):
   - Litestream: does it replicate and restore correctly?
   - Turso Cloud: sync, embedded replicas, or point-in-time restore, and what each
     costs and requires;
   - backups to S3 or another local target that Turso or others provide, and how mature
     they are;
   - snapshots (the backup API or `VACUUM INTO`) as the fallback.

   Restore every candidate into a working database in a test, rather than relying on its
   documentation.

## Outcome

A recommendation, with the measurements:

- **Stay on SQLite:** when the gain is small. Record the numbers, so the question isn't
  reopened without new evidence.
- **Switch to Turso:** when the gain is significant and a backup solution passes the
  restore tests.
- **Both as recipes in the porting kit:** when the gain is significant but the backups
  depend on Turso Cloud.

## Acceptance criteria

- [ ] Speed and memory against `rusqlite` with the read pool, recorded here
- [ ] Compatibility with the app's schema, SQL, and migrations, recorded here
- [ ] The porting cost estimated
- [ ] Each backup option tried with a restore, recorded here
- [ ] A recommendation, and task 081's README updated if it changes "Turso's engine comes
      later"
