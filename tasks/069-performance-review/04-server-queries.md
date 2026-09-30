# 04: Server queries

Status: todo

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
