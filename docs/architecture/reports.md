# Reports

## Report export

Reports exports the report as shown, for the current filters (task 034, `prototypes/README.md`,
Reports): the timesheet and the entries behind it, as CSV or as one XLSX file with a sheet for
each. Narrowed to one project (`projectId` in `ReportInput`, a project's ID or `none`), it is
that project's report for its client (task 068).

- Where: the browser builds the files (`src/features/reports/export.ts`), naming the rows from
  the cached lists as the grid does. The timesheet CSV is the report already on screen, counted
  up to when it loaded. The entry list and the XLSX come from `getReportExport`, which reads
  what `getReport` reads under the same role rules, so the server enforces them. Building in the
  browser keeps the files out of the Vercel functions, and the XLSX library loads only when
  someone exports.
- Pieces: the browser fetches the entries one calendar month of the range at a time, or in one
  call for a range within a month, and the server takes a piece of at most 31 days, so each
  response stays well under Vercel's 4.5 MB limit whatever the organization's size
  (`hosting.md`). The Export menu shows how many pieces have loaded, and a failed piece fails
  the export.
- One moment: the first piece also returns the report, counted up to the server's now, and
  the browser passes that `now` to every later piece; the server counts a piece up to it, or
  up to its own now if that is earlier. So a running entry counts up to the same moment in
  every piece and in the report, which the XLSX's timesheet shows, and the two sheets agree
  while a timer runs. An entry edited while the pieces load can still make them differ.
- Size: each entry row carries only what the files show, a piece's start and duration rather
  than its end, and no entry id or whole-entry times, which only the Entries card needs.
- Order: the XLSX opens on the entries, the part a client or an invoice needs, with the
  timesheet as a second sheet; the menu lists them in the same order.
- For a client: the files are in English whatever the UI language, headers, sheet names, and
  the "No project", "No team", and "No ticket" rows alike, and the user's own name has no
  "(you)".
- Entries: each entry's time on each day, clipped to the range and split at the user's
  midnights like the totals, with its project, member and their email, ticket, and its start
  and end in the user's zone; a running entry counts up to now and has no end. They're sorted
  by project ("No project" last), then date, member, and start, and add up to the report's
  totals.
- Durations: decimal hours in CSV (two places), and numbers in XLSX, as fractions of a day with
  the `[h]:mm` format, so they add up in the spreadsheet; the XLSX's entries add decimal hours
  next to them, for invoices. Dates are ISO days, since they're the user's days, not
  instants.
- CSV: RFC 4180 with commas and dots, UTF-8 with a byte order mark so Excel reads non-ASCII
  names, and text starting with `=`, `+`, `-`, `@`, a tab, or a carriage return gets a leading
  apostrophe against formula injection. XLSX writes text as strings, never formulas.
- File names: the organization's short name and the range's first and last days, such as
  `snowhound-2026-09-01-to-2026-09-30.csv`, with `-entries` for the entry list.

## Report entries

The Reports page's Entries card lists the entries behind the report (task 055,
`prototypes/README.md`, Reports), so a team lead can see what a member worked on.

- Source: `getReportEntries` reads the day pieces `getReportExport` builds, under the same role
  rules, so the card and the export list the same entries and count a running timer up to the
  moment of the read. Choosing a row narrows the pieces to its project, ticket, team (its
  current members), or member. Choosing a day or week narrows the report's range to that
  bucket instead. Every view narrows the card ("Report views"), through the same `row` and
  `bucket` search params.
- Loading: the list has its own query under `reportsKey`, which loads only in the browser
  and only while the card is open, so the timesheet opens as fast as without the card and a
  closed card costs nothing. The server never renders the list: a cold year view by week sent
  5 MB of HTML while it did. The header's count and total come with the report (`entries`
  and `total`); for a chosen part, `getReportEntryTotals` counts them without the list. Timer
  writes mark both stale with the reports.
- Grouping: the server groups the list, because an admin's "Everyone" for a month in a
  50-person organization is about 4,000 entries, several hundred KB of JSON. By description
  sends its 25 rows with the most time (`DESCRIPTION_PAGE_SIZE`) and the number of rows; "Show
  all" loads the rest, which for a year of the Lumen Works seed is about 7,900 rows. By
  day returns a page of at most 100 pieces (`ENTRY_PAGE_SIZE`), newest day first, and each
  person's pieces together.
  A page ends with a whole day unless one day alone fills it, and each page carries its days'
  whole totals, so a heading is right when its day continues on the next page. Pages count
  entries rather than days, because one day of a large organization can hold hundreds.
- Cursor: a page asks for the pieces after the last one it has, by date, user, start, and
  entry id, so an entry added between two pages doesn't repeat or skip a piece. Each call
  reads the entries up to the cursor's day again and sorts them in TypeScript, so the
  response stays bounded.
- Narrowing: a row narrows the read in SQL: a project or ticket to its column, a member to
  their user, a team to its current members, and "No team" to users in none of the report's
  teams. One ticket reads through the `(organization_id, ticket, started_at)` index, so a
  year of it touches that ticket's entries only.

## Report views

The Reports page shows one report in three views, as tabs between the filters and the report
(task 064, `prototypes/README.md`, Reports): Timesheet, the grid; Summary, a totals line, a chart
of time per day or week by project, and share bars; and Breakdown, a two-level outline of who
worked on what.

- The view is the `view` search param (`summary` or `breakdown`); Timesheet, the default, has
  none, and the page doesn't remember the last view. Switching views drops the Entries card's
  narrowing and list choice, as a filter change does. Export sits in the tab row and always
  gives the timesheet and its entries.
- Summary and the Timesheet read the same `getReport` result. `getReport` returns
  `trackedDays`, the days with time, so Summary's average per tracked day holds when the
  buckets are weeks. The chart always stacks by project, whatever the grouping, and folds the
  projects past seven into "Other" when there are more than eight, so the colors stay apart.
- Breakdown's second level, project × member and ticket × member, comes from
  `getReportBreakdown`, which reads what `getReport` reads under the same role rules and sums
  each entry's time in the range. It is a separate function, loaded only by Breakdown, so the
  report every view loads doesn't grow by a row per pair. Member × project reuses the project
  pairs, and team × member comes from team membership and the report's member totals, so it
  needs no call. Members get one level, since all the time is theirs. Breakdown totals the
  range, so Totals per is disabled on it rather than hidden, which keeps the filter row still.
- Narrowing: a Summary chart column narrows the Entries card to its day or week, and a share
  row's total to its row. Summary's share rows and Breakdown's top level are one `ShareRow`
  (`share-bar.tsx`), which narrows from the total rather than the name, since Breakdown's
  names sit in a `<summary>` that can't hold a button. A second-level row doesn't narrow,
  because the card filters by one grouping at a time.
- Width: the timesheet widens with its columns up to the window's; Summary and Breakdown keep
  the header's 68rem. The chart is drawn to its container's width, so a container that fits
  its content would feed the chart's width back into itself.

## Ticket keys

An entry has at most one ticket key, such as `NBW-412` (task 060, `prototypes/README.md`,
timer.html, "Ticket keys").

- Storage: the nullable `time_entry.ticket` column, indexed on
  `(organization_id, ticket, started_at)` for a report's entries of one ticket. One ticket per
  entry keeps reports by ticket adding up to the total and matches tracker worklogs, which
  belong to one issue each.
  Work on two tickets is two entries, or one with the second key in its text. A
  `time_entry_ticket` table would be needed only for several tickets per entry.
- Detection: the client finds the ticket when a description is committed (Enter, blur,
  Start, Save), never while typing, with `detectTicket` in `src/lib/tickets.ts`, which the
  seeds also use. A key is a letter, one to nine more letters or digits, a dash, and a number
  of one to seven digits that doesn't start with 0.
  - A key at the start, optionally in brackets and followed by `:`, `|`, `,`, `/`, a dash,
    white space, or the end, becomes the ticket and leaves the text. It replaces any ticket
    the entry had.
  - A key later in the text becomes the ticket only when the entry has none, and stays in
    the text, so the sentence still reads.
  - A pasted issue link (`…/browse/KEY`, `…/issue/KEY`, `…/issues/KEY`) becomes its key.
  - `UTF-`, `ISO-`, `SHA-`, and `COVID-` numbers stay text, and so do keys the saved
    description already has. A chip's × puts its key back at the start of the text, so the
    key isn't found again.
- The server checks only the ticket's format (`Ticket` in `src/server/schemas.ts`).
  `createEntry`, `updateEntry` (the running entry's too), and `startTimer` take it, and
  `updateEntry` removes it with null.
- Existing entries: the `time_entry_ticket` migration moved the key at the start of each
  description into the ticket, in SQL that follows the same rules;
  `src/db/ticket-backfill.test.ts` checks the SQL against `detectTicket`. It left pasted
  links and later keys as they were, since those don't change the text.
- Issue links: `organization.issue_links`, an app column that Better Auth never reads or
  writes, like `team_member.role` ("Tenancy" in [data.md](data.md)). `updateIssueLinks` in the
  auth domain lets admins and owners set it to an `https://` address with a host name that has
  a dot, a path, and `{key}`, or clear it to null. `getAppSession` returns it with each
  organization; with it set, chips link to the issue in a new tab, and without it they are
  plain labels.
- Reports group by ticket, with a "No ticket" row. By description keeps work on different
  tickets apart, and both exports have a Ticket column. The filter bar has no ticket search:
  a Project select took its place (task 068).
