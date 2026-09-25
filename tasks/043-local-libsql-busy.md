# 043: Local database writes after SQLITE_BUSY

Status: todo

Task 039 found on 2026-09-25 that `@libsql/client` 0.18 with a `file:` URL can hold a
connection's later writes back after a statement fails with `SQLITE_BUSY`. Other
connections don't see those writes, so they may never reach the file. The client runs
each call on a pooled connection, and a transaction holds its own for its lifetime, so
the dev server can contend with itself. It can also contend with a second process, such
as `db:migrate`, `db:seed`, or the `sqlite3` shell. Production uses Turso over HTTP and
isn't affected.

Repro, in a script with two clients on one file: client 2 opens a write transaction and
inserts a row. Client 1's insert then fails with `SQLITE_BUSY`. Client 2 commits, and
client 1 inserts again. A third, fresh client sees client 2's row but not client 1's
second one.

## Acceptance criteria

- [ ] The cause is pinned down: which statement stays open (the client prepares each
      statement and doesn't reset it after an error), and whether the pool's release
      check (`db.inTransaction`) misses it
- [ ] Local connections wait instead of failing at once: a busy `timeout` in the
      connection config of `src/db/index.ts` and `src/db/testing.ts`, WAL mode, or both,
      tested with the repro above
- [ ] If it is a client bug, it is reported upstream with the repro, and the version
      that fixes it is noted here
