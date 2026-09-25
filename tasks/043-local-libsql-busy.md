# 043: Local database writes after SQLITE_BUSY

Status: in-progress

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

- [x] The cause is pinned down: which statement stays open (the client prepares each
      statement and doesn't reset it after an error), and whether the pool's release
      check (`db.inTransaction`) misses it
- [x] Local connections wait instead of failing at once: a busy `timeout` in the
      connection config of `src/db/index.ts` and `src/db/testing.ts`, WAL mode, or both,
      tested with the repro above
- [ ] If it is a client bug, it is reported upstream with the repro, and the version
      that fixes it is noted here

## Findings (2026-09-25)

The failed `INSERT` stays open. `executeStmt` in `@libsql/client` runs
`db.prepare(sql).run()`, and the `libsql` binding (0.5.29, also 0.6.0-pre.42) has no
`reset()` or `finalize()` on a statement, so one that failed with `SQLITE_BUSY` stays
active until garbage collection finalizes it. While it is active, SQLite doesn't commit
the connection's later autocommit writes. The connection reads its own rows, and nobody
else sees them. `db.inTransaction` reports `false` and `COMMIT` fails with "no
transaction is active", so the pool's release check misses it. Finalizing the statement,
or closing the connection, rolls the held writes back, so they never reach the file.

The same sequence works with `db.exec()` (which finalizes) and with `bun:sqlite`, so the
bug is in the `libsql` binding. WAL mode doesn't help: the repro loses the write there
too, and WAL doesn't stop two writers conflicting.

Both connection configs now set `timeout: BUSY_TIMEOUT_MS` (5000, `src/db/connection.ts`).
A write then waits out another process's lock, and `src/db/connection.test.ts` checks
that with a child process holding a write transaction. The timeout doesn't cover two
connections in one process: the binding is synchronous, so the wait blocks the event
loop, and the transaction holding the lock can't commit until the wait ends. The dev
server's transactions contain only database calls, so they don't wait on other I/O while
holding the lock. The remaining fix belongs upstream: reset a statement after an error,
or have the client's pool close a connection whose statement failed.
