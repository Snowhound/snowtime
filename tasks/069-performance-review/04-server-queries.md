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
- [x] Each candidate done or left, with its numbers
- [x] Query plan snapshots updated, with no scan of `time_entry` on a hot path
- [x] Any schema change follows `docs/migrations.md`, and `datamodel/` is regenerated
- [x] `reports.test.ts` and the timer tests pass unchanged; new tests compare SQL and
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

- **Covering report indexes.** Replace both organization/time and organization/user/time
  indexes with the same prefixes plus `sys_deleted`, `stopped_at`, `project_id`, and
  `ticket` (and `user_id` on the organization/time index). Both report entry reads now
  say `USING COVERING INDEX`; the member read keeps its user/time bounds. The prefixes
  still serve older app versions. Migration, drift check, and regenerated diagrams agree.
  SQL rows and wire bytes stay unchanged:

  | Range | Admin rows / SQL JSON bytes | Member rows / SQL JSON bytes |
  | ----- | --------------------------- | ---------------------------- |
  | Week  | 362 / 62,330                | 23 / 3,924                   |
  | Month | 1,655 / 285,283             | 64 / 11,013                  |
  | Year  | 20,163 / 3,473,394          | 1,187 / 204,448              |

  Raw statement medians (10 measured calls after 2 warm-ups), old/new/old/new in one
  session, in ms:

  | Range / user | Old   | Covering | Old   | Covering |
  | ------------ | ----- | -------- | ----- | -------- |
  | Week admin   | 0.58  | 0.42     | 1.05  | 0.73     |
  | Month admin  | 2.23  | 1.99     | 3.30  | 2.85     |
  | Year admin   | 31.90 | 29.43    | 34.82 | 36.90    |
  | Week member  | 0.070 | 0.123    | 0.086 | 0.063    |
  | Month member | 0.119 | 0.112    | 0.110 | 0.103    |
  | Year member  | 1.41  | 1.91     | 1.62  | 1.50     |

  Timings are noisy; the stable gain is eliminating the table lookup for each matching
  report entry. `bun run perf` passes before and after; reports and timer tests are
  unchanged. Rows visited inside SQLite remain unavailable through libsql.

- **By-day paging in SQL.** A `started_at DESC LIMIT` probe selects the oldest day needed
  for a page. The read then fetches those whole days, including entries starting up to
  24 hours before the boundary. The cursor narrows the upper day bound; `dayPage` keeps
  the member/time/ID order within that day. If the cursor leaves too few pieces, the
  probe doubles its limit until there is a next page or the range is exhausted. This
  avoids returning the entire year while retaining whole-day totals and current cursors.
  The usual page still uses one entry statement and needs no new index. A new test
  compares every SQL-window page with the unchanged JavaScript `dayPage`, including a busy day split across pages,
  tied times across members, DST, overnight work, running time, and future stopped work.

  First-page harness results, old/new/old/new in this session (ms are medians of 5):

  | Range / user | SQL rows before → after | Response bytes (unchanged) | Old  | New | Old   | New |
  | ------------ | ----------------------- | -------------------------- | ---- | --- | ----- | --- |
  | Week admin   | 383 → 130               | 1,817                      | 1.5  | 1.3 | 1.5   | 1.1 |
  | Month admin  | 1,676 → 130             | 1,817                      | 5.6  | 1.5 | 5.4   | 1.5 |
  | Year admin   | 20,184 → 130            | 1,817                      | 58.5 | 7.9 | 121.1 | 8.8 |
  | Week member  | 24 → 24                 | 9,665                      | 0.3  | 0.9 | 0.3   | 0.7 |
  | Month member | 65 → 65                 | 26,918                     | 0.5  | 2.0 | 0.7   | 1.3 |
  | Year member  | 1,188 → 104             | 41,074                     | 6.2  | 8.2 | 7.8   | 5.6 |

  The SQL probe adds local work for short member ranges; it saves no returned rows there.
  Large admin reports save about 99% of returned rows. The plan harness now checks the
  first and second day pages as well as an admin's member-filtered report.

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

- **Organization-only covering index, dropped.** It removed admin table probes (year
  raw query 32.96 → 23.96 ms, then 28.83 → 23.50 ms in alternating runs), but the
  member report then chose that broader index and filtered users: year 1.58 → 3.64 ms,
  then 1.40 → 3.70 ms. Covering the existing member index too restores its narrow bounds.
  Rows and SQL JSON bytes were unchanged in both variants.
- **Member-filtered report.** Both a plain member and an admin filtering to that member
  use `USING COVERING INDEX time_entry_organization_id_user_id_started_at_idx`, with
  organization, user, and both time bounds. No index hints or statistics are needed.
  Raw rows, bytes, and alternating timings are in the covering-index table above.
- **SQL day aggregation, dropped.** A `json_each` of the time zone's day starts/ends joins
  the range entries, clips each span to each day (including capped running entries), and
  groups by day/user/project, with ticket added when requested. The same seed and filters
  alternate raw entry reads and grouped reads, twice. The reduction is only about 2.1–2.3×
  in rows and 2.7–2.9× in SQL JSON bytes without tickets; with tickets it is about 1.3×
  and 1.5×. That is not a large enough reduction for the extra day-split aggregation.
  The JavaScript `aggregate` stays unchanged; no SQL totals implementation is retained.

  These are entry-statement rows and serialized SQL result bytes, excluding settings,
  teams, and former members. Bytes estimate transport payload, not Turso HTTP framing.
  Values with tickets are shown after the slash:

  | Range / user | Raw rows | Grouped rows, no tickets / tickets | Raw bytes | Grouped bytes, no tickets / tickets |
  | ------------ | -------- | ---------------------------------- | --------- | ----------------------------------- |
  | Week admin   | 362      | 175 / 275                          | 62,330    | 23,370 / 41,585                     |
  | Month admin  | 1,655    | 769 / 1,234                        | 285,283   | 103,171 / 186,917                   |
  | Year admin   | 20,163   | 9,389 / 14,959                     | 3,473,394 | 1,259,866 / 2,264,794               |
  | Week member  | 23       | 10 / 14                            | 3,924     | 1,330 / 2,085                       |
  | Month member | 64       | 28 / 48                            | 11,013    | 3,752 / 7,241                       |
  | Year member  | 1,187    | 544 / 904                          | 204,448   | 73,092 / 136,713                    |

  Raw/grouped/raw/grouped statement medians, 5 runs after 2 warm-ups (ms, no tickets):

  | Range / user | Raw   | Grouped  | Raw   | Grouped  |
  | ------------ | ----- | -------- | ----- | -------- |
  | Week admin   | 0.72  | 1.40     | 0.67  | 1.36     |
  | Month admin  | 2.22  | 12.09    | 2.25  | 12.76    |
  | Year admin   | 27.16 | 1,460.10 | 23.78 | 1,508.05 |
  | Week member  | 0.092 | 0.158    | 0.066 | 0.148    |
  | Month member | 0.138 | 0.411    | 0.123 | 0.408    |
  | Year member  | 1.45  | 74.38    | 1.47  | 75.94    |

  This naive join also multiplies work by the days in the range. A better join could cut
  that CPU cost, but cannot remove the required day/key result groups. It was dropped
  on the rows/bytes condition before implementing SQL totals or changing tests.

- **Timer lookups, left unchanged.** The own-week list uses the organization/user/time
  index with both time bounds. Running-entry reads use the partial unique
  `time_entry_one_running` index and indexed organization, membership, and project
  probes. No entry scan or temp sort. After 2 warm-ups, medians of 10 local calls:
  admin list 0.26 ms, 8 SQL rows, 4,325 response bytes; member list 0.27 ms, 27 rows,
  14,748 bytes. Both running reads return null on the harness seed (0 rows, 4 bytes):
  admin 0.37 ms, member 0.26 ms. Existing timer tests cover active running entries.
  Covering the list would include descriptions and audit columns; this small read does
  not justify that index. No timer query or test changed.

## Open for review

- Kait: review the larger covering indexes against the saved table probes. Local timings
  do not establish a reliable whole-report speedup or Turso billed-row savings.
- Kait: weigh the extra sub-millisecond to millisecond SQL work on short member ranges
  against the year-page row reduction. The member year timings overlap across runs.
- A busy day still reads all its entries to preserve the whole-day total. Paging within
  that day still applies the member/time/ID cursor in JavaScript, and may repeat probes.
  Fully paging that ordering in SQL with a separate day-total query remains unimplemented.
- SQLite rows visited and Turso billed rows are unavailable here. The first acceptance
  criterion remains open for that part; harness rows count returned rows.
- No Turso latency or write-cost measurement, and no `perf:pages` run: this subtask does
  not require a browser harness. No SQL aggregate remains to compare with the reference.
