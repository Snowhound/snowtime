// Connection settings shared by the app's database client and test databases.

// How long a local file: database waits for another process's lock before failing with
// SQLITE_BUSY: db:seed, db:migrate, or the sqlite3 shell against the dev server's file.
// @libsql/client 0.18 can lose a connection's later writes after a SQLITE_BUSY (task
// 043), so waiting also keeps those writes. Remote Turso URLs ignore it. The wait blocks
// the process, so it doesn't help two connections in one process: the one holding the
// lock can't commit until it ends.
export const BUSY_TIMEOUT_MS = 5000
