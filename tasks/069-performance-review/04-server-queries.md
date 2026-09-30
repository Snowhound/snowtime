# 04: Server queries

Status: in-progress

The report reads every entry in its range and sums it in JavaScript (`aggregate` in
`src/server/reports/reports.server.ts`). For a year of the company seed that is about 20,000
rows, each with a user ID, project ID, ticket, and two times, sent from Turso over HTTP on
every report load, and Turso bills by rows read. Task 044 cut the round trips; this subtask
looks at what each one reads and sends.

Writes are human-rate: a timer start or stop, an edit. An extra index costs little here, so
a covering index is fine when it removes table reads from a hot query.

## Candidates to check

- Summing in SQL. The day splitting in the user's time zone is why it's in JavaScript: an
  entry across midnight counts on two days. SQL can do the same split against the range's
  day starts (the table `aggregate` already builds), passed in as a `VALUES` list or a
  `json_each` of the boundaries, and group by bucket, user, project, and ticket. The query
  then returns one row per bucket and key instead of one per entry. `trackedDays` needs the
  days too, so group by day, not bucket, or count days in a second small query. Keep the
  JavaScript `aggregate` as the reference: the tests run both on the same data and compare.
  Worth it only if the harness shows the rows and bytes drop by a large factor for a month
  and a year; for a week the entries may be fewer than the grouped rows.
- `getReportEntries` pages by day in memory (`dayPage`), so each page reads every entry in
  the range. Keyset paging in SQL (`started_at` before the cursor, `LIMIT`) reads one page,
  with the running and cross-midnight entries handled as they are now.
- A covering index for the report: `time_entry (organization_id, started_at)` plus the columns
  the report reads, so SQLite doesn't look up each row in the table. It can replace
  `time_entry_organization_id_started_at_idx` rather than sit beside it. Check the query plan
  for "USING COVERING INDEX".
- The member-filtered report: whether `organization_id, user_id, started_at` is used, or the
  planner picks the organization index and filters.
- `ANALYZE` (or `PRAGMA optimize`) after migrations, so the planner has statistics on Turso.
  Check whether Turso keeps them and whether the plans change with them.
- `formerMembers` runs after the aggregation: one more round trip on every report. It could
  run in parallel with the entries by reading the users of the entries' range.
- The timer's entry list and the running-entry lookups, with the same questions, briefly;
  task 057 looked at the timer before.

## Acceptance criteria

- [ ] Rows read, rows and bytes returned, and time per call, before and after, for a week, a
      month, and a year, as admin and as a member (harness)
- [ ] Each candidate done or left, with its numbers
- [ ] Query plan snapshots updated, with no scan of `time_entry` on a hot path
- [ ] Any schema change follows `docs/migrations.md`, and `datamodel/` is regenerated
- [ ] `reports.test.ts` and the timer tests pass unchanged; new tests compare SQL and
      JavaScript totals where both exist

## Done

- **`formerMembers` in parallel.** `getReport` reads the former members beside the entries, so
  a report is two sequential round trips after the context reads instead of three. The
  statements per call stay the same: admin 4 (settings, teams, entries, former members),
  member 2, because a member's only user is themselves and the read is skipped. The query
  finds the organization's users with entries and no membership, through a recursive CTE
  that steps over `time_entry_organization_id_user_id_started_at_idx` (one covering probe
  per user, no `SELECT DISTINCT` over the entries), then probes each candidate for an
  entry in the report's range on the same index. `reportOf` keeps the candidates who have
  counted time, which covers the cases the range probe can't (a project filter, a running
  entry before `now`), so the result is the same as before. Plan: no `SCAN time_entry`, no
  temp B-tree; rows, bytes, and `reports.test.ts` unchanged. A test covers a former member
  with entries only outside the range. The local file database barely shows the gain (year,
  admin: 77 ms before, 43 to 47 ms after, but that is noise-level on one machine); the
  saving is one Turso round trip per report.
  - Tried and dropped: `user.id in (select user_id from time_entry where <range>)` scans
    and looks up every entry in the range (15 ms against 0.1 ms for a year of the company
    seed, and Turso bills the rows it reads). Leaving the range out entirely returned one
    extra row in the week and month reports, which the rows gate rejects.

## Checked and left as is

- **`ANALYZE` and `PRAGMA optimize`.** On a copy of the seeded database, `ANALYZE` changed
  12 of 52 hot plans. None touched the entries reads, which keep their index: the
  `team` left join went from `SEARCH team USING INDEX team_organization_id_name_unique` to
  `SCAN team USING COVERING INDEX team_id_organization_id_unique` (a handful of rows), and
  the new former-members query went from `SEARCH user` to `SCAN user` (27 users, each a
  probe). `PRAGMA optimize` on a connection that had run a few queries analyzed only the
  tables those queries used and changed the 9 team plans the same way. On a fresh
  connection it did nothing, and `PRAGMA optimize(0x10002)` did nothing either until a
  query had used the table, so a `db:migrate` run would analyze nothing.
- **Turso.** Its docs describe `ANALYZE` writing `sqlite_stat1` but say nothing about
  running it automatically
  (<https://docs.turso.tech/sql-reference/statements/analyze>). A third-party probe
  dated 2026-08-27 reports that the libSQL server, on both self-hosted `sqld` 0.24.33 and
  a Turso Cloud database, refuses `ANALYZE` and `PRAGMA optimize` through its statement
  allowlist (<https://libredb.org/blog/libsql-read-only-token-boundary/>). We haven't
  tried it against our database.
- **Recommendation.** Don't add `PRAGMA optimize` to `db:migrate`: it would analyze nothing
  after a migration, may be refused on Turso Cloud, and the plans that matter already use
  the right indexes without statistics.
