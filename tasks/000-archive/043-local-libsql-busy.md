# 043: Local database writes after SQLITE_BUSY

Status: done

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
- [x] ~~If it is a client bug, it is reported upstream with the repro, and the version
      that fixes it is noted here~~ Declined by Kait on 2026-09-30: no upstream report.
      The bug is in the `libsql` binding (0.5.29 still has it), and the busy timeout and
      async test cleanup work around it locally

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

## Test databases on Windows (2026-09-30)

The same missing `finalize()` kept every `bun test` database file open on Windows, so
removing a test database failed with `EBUSY`. `client.close()` doesn't release the file:
the binding's `close()` fails while any statement is unfinalized, and the pool swallows
the error. The file closes once garbage collection frees the statements, which happens
only after the event loop has turned. `cleanup()` in `src/db/testing.ts` is now async: it
closes the client, then retries the removal, forcing a collection between tries. A
binding that finalizes statements would make those retries unnecessary.

## Requests in one process (2026-09-30)

The note above that the dev server's transactions hold the lock only briefly didn't hold
under load. A transaction awaits between its statements, so another request's write runs
on a second connection in between, and its busy wait freezes the process until it fails.
On the benchmark database, 18 concurrent users each starting, reading, and stopping a
timer and loading a month report 10 times (720 calls) took 152 s: 180 calls failed with
`database is locked` or "cannot commit transaction - SQL statements in progress", and one
call waited 101 s.

`openClient` in `src/db/connection.ts` now queues every statement of a `file:` client
while a transaction is open, so requests in one process never meet each other's lock. The
same run took 2.9 s with no errors and a slowest call of 143 ms. `src/db/connection.test.ts`
checks a write issued during an open transaction. Code inside a transaction must use its
handle: a call on `db` there would wait for the transaction to end. Another process holding
the lock for more than `BUSY_TIMEOUT_MS` can still trigger the binding bug.
