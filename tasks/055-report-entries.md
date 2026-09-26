# 055: Entries on the Reports page

Status: in-progress

`docs/product.md` says team leads see their teams' entries. The Reports page only shows
totals, and the Timer page lists only the user's own entries. So a lead can't see in the
app what a member worked on in a week or month. The Entries CSV and the XLSX's second
sheet are the only way to see them.

An Entries card below the timesheet lists the entries behind the report for the same
filters (range, People, Group by). `getReportExport` already builds this list
(`ReportEntryPiece`), with the same permission checks. Keeping the card on the Reports page
lets one URL share both the totals and the entries. The prototype's section in
`prototypes/README.md` describes the design.

`getReport` sends totals, which grow with rows times days; an entry list grows with the
entries. An admin's "Everyone" for a month in a 50-person organization is about 4,000
entries, several hundred KB of JSON, so the card loads apart from the report and in pages.
Task 053 measured the Reports page at 19–25 ms of main-thread work and 550 DOM nodes, and
the timer at 79–82 ms with 417 inputs and buttons; the card must not take Reports there.

## Acceptance criteria

- [x] `prototypes/reports.html` shows the Entries card for a member, a team lead, and an
      admin, checked per `docs/skills/ui-review/SKILL.md`, before the app changes
- [x] The card lists the report's entries grouped by day: a date heading with the day's
      total, then each entry's time span, description, project, and duration. A member
      column shows only when the selection covers more than one person.
- [x] A "By description" view merges entries with the same description and project into
      one row with their total time and entry count. It is the default for spans longer
      than seven days; the user's choice holds until a filter changes.
- [x] Choosing a timesheet row or cell narrows the card to that project, team, or member
      and that day or week. The narrowing lives in the URL, like the other filters.
- [x] Entries are read-only in the card. Only the owner edits an entry, from the Timer page.
- [x] The card and the export read the same server list, so they show the same entries,
      and a running timer counts the same in both
- [x] The card loads through its own query, not the route loader, so the timesheet opens as
      fast as before and the card shows a loading state until its entries arrive
- [x] The server groups and pages the list: "By description" returns only the merged rows,
      and "By day" returns one page at a time, capped by entry count (about 100) rather
      than by days, so "Everyone" in a large organization stays bounded. The paging is
      recorded in `docs/architecture.md`.
- [ ] Opening Reports with cached data stays under 50 ms of main-thread work at 1×, measured
      as in task 053 for a month by project with many projects, with the 4× figure recorded
      here. If the timesheet's cell buttons push it over, only row names and column headers
      become buttons.
- [x] Tests cover the grouping, the "By description" merge, the narrowing, and that a lead
      sees only their teams' entries
- [x] The Reports row in `docs/product.md` lists the entries

## Findings

Measured on 2026-09-26 as in task 053 (subtask 06): a local production build served on port
3100, a freshly seeded throwaway database, the seeded owner at 1440 × 900 in headless Chrome,
3 runs each. The database also had 40 projects in Northwind with 1,064 entries on September's
weekdays, so the page opens on this month by project with 40 rows of 30 days, By description.
"Net" subtracts an idle trace of the same length; milliseconds.

| Build                                        | Longest task, 1× | Net, 1× | Longest task, 4× | Net, 4× | DOM nodes |
| -------------------------------------------- | ---------------- | ------- | ---------------- | ------- | --------- |
| Before this task (`8cacda7`)                 | 53–61            | 77–89   | 248–291          | 336–387 | 1,990     |
| Entries card, row names and headers buttons  | 60–66            | 87–95   | 254–302          | 341–369 | 2,335     |
| Entries card, names, totals, and cells (app) | 64–70            | 89–98   | 279–302          | 372–413 | 2,966     |

- The page misses the 50 ms criterion on this data before the card exists. Task 053's
  19–25 ms came from the seed's five projects; 40 projects × 30 days take 77–89 ms without
  the card. Task 059 covers the grid.
- The card adds 6–10 ms at 1×: its header and 25 By description rows, about 315 nodes.
- The cell buttons add about 630 nodes and 2–3 ms at 1×, 30–45 ms at 4×. They don't push
  the page over the limit, since it was over already, so they stay, as the prototype has
  them. Making only row names and column headers buttons would save that time, but the card
  could no longer narrow to one project's or member's day.
- The Reports chunk grew from 27 kB to 41 kB (13 kB gzipped).
- Checked in the dev app per `docs/skills/ui-review/SKILL.md` as a member (Harbor, this
  week), a team lead (Harbor, this month), and an admin (Northwind, in Estonian), at 1440,
  850, and 390 px, dark and light: no horizontal overflow, no browser errors, and no axe
  violations. By day's first page for Northwind's whole last week ended with Thursday, 86
  pieces, and the next page held the other three days. Keyboard narrowing keeps focus on
  the pressed button. The check found two bugs, both fixed: the card didn't scroll into
  view when the narrowed list replaced a longer one, and a running entry's earlier day had
  no midnight mark.
