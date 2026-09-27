# 03: Time and reports

Status: done

Totals depend on time zones, week starts, and entries that cross midnight, which the
seeded data covers only partly.

## Acceptance criteria

- [x] Days, weeks, and ranges follow the user's time zone and week start, including
      across daylight saving changes
- [x] Entries that cross midnight or a range boundary are split or counted as
      documented, in the timer list, summary, reports, and exports
- [x] Range queries include every overlapping entry under the 24-hour bound, including
      the running timer
- [x] Report totals, the timesheet, and CSV and XLSX exports agree for the same filters
      and scope
- [x] Date and time input accepts the formats the settings allow and rejects impossible
      values without data loss

## Findings

Reviewed on 2026-09-25 by reading the code, and with scripts run against
`src/lib/calendar.ts` and `src/lib/date-input.ts`, and Chrome against the dev app.

### Fixed

- Task 046: the timer view kept the day it opened on. Past midnight, its day labels and
  summary stayed on the previous day while no timer ran, and the list kept asking for the
  days up to the passed midnight, so a new entry dropped out of it on the next refetch.
  Today now moves on at the zone's midnight and when the tab shows
  (`timer-view.test.tsx`).
- Task 047: an XLSX export's Timesheet sheet was the report on screen, and its Entries
  sheet a later `getReportEntries` call, so while a timer ran in the range the entries
  added up to more than the timesheet. `getReportExport` now returns both from one read
  (`export-menu.test.tsx`, `reports.test.ts`).
- Task 048, outside this area: the first full page load after signing in answered 500
  ("Select an organization first"), because the loaders read Better Auth's cached session
  from before `getAppSession` set the active organization. Every provider sign-in met it.
  `scopeMiddleware` now reads the session again when the cached one gives no scope
  (`scope.test.ts`).

### Checked and sound

- Zone math (`calendar.ts`): for every day of 2026 in Tallinn, Santiago, New York, Lord
  Howe (30-minute shift), Kolkata, and Chatham, `startOfDay` is the first instant whose
  local date is that day. Days are 23 or 25 hours at transitions, and a midnight skipped
  by the clocks starts the day at the jump (Santiago, Beirut, Havana, São Paulo 2018).
  Splitting 24-hour spans started every 7 h 13 min through the year covers each span
  exactly, in date order. Weeks start on the week start setting and span a transition
  (167 hours).
- `atLocalTime`: a skipped time counts the same distance past the jump (03:30 on
  2026-03-29 in Tallinn is 04:30), and a repeated one is its first occurrence.
- Range queries: `listEntries`, `getReport`, and `getReportEntries` read entries started
  after `from - 24 h` and before `to` and not stopped by `from`, strictly. An entry
  exactly 24 hours long ending at `from` stays out, as it should. A running entry counts up
  to now, and at most 24 hours, which is where `stopTimer` ends it (`stopAt`).
- Reports: buckets start on the range's first day or its week start; a partial first or
  last week counts only the range's days. Team totals add each team's current members,
  and "No team" adds admins' members in no team. Custom ranges are at most 371 days and
  in order; a bad URL opens this month.
- Timer list and summary: the list groups entries by the day they start, with stopped
  time only; the summary clips to today and this week, and counts the running timer of
  this organization up to now. Both follow the documented rules.
- Exports: the entry list clips and splits as the totals do, and a piece ending at
  midnight ends at 24:00. CSV rounds each duration to 0.01 h, so a row's cells can differ
  from its total by 0.01 h, as documented; XLSX keeps exact fractions of a day.
- Input: every minute of the day survives formatting and reading back in English and
  Estonian, with 24-hour and 12-hour clocks. Every date from 1999-12-25 to 2031-01-04 does
  too, in both date formats. `31.2.2026`, `2/30/2026`, `29.02.2027`, `24:00`, `12:60`, and
  `13pm` are refused. A time field left unreadable blocks saving with "missing" rather than
  saving something else, and an unreadable date goes back to the last value on blur.

### Accepted

- On the day clocks fall back, the entry form can't express an entry from the first 03:30
  to the repeated 03:15. It reads the end as the next day and refuses the entry as longer
  than 24 hours, so nothing is saved wrongly.
- A running entry past the 24-hour cap exports with its end at the cap, where stopping it
  would end it, rather than without an end.
