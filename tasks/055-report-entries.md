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
- [ ] The card lists the report's entries grouped by day: a date heading with the day's
      total, then each entry's time span, description, project, and duration. A member
      column shows only when the selection covers more than one person.
- [ ] A "By description" view merges entries with the same description and project into
      one row with their total time and entry count. It is the default for spans longer
      than seven days; the user's choice holds until a filter changes.
- [ ] Choosing a timesheet row or cell narrows the card to that project, team, or member
      and that day or week. The narrowing lives in the URL, like the other filters.
- [ ] Entries are read-only in the card. Only the owner edits an entry, from the Timer page.
- [ ] The card and the export read the same server list, so they show the same entries,
      and a running timer counts the same in both
- [ ] The card loads through its own query, not the route loader, so the timesheet opens as
      fast as before and the card shows a loading state until its entries arrive
- [ ] The server groups and pages the list: "By description" returns only the merged rows,
      and "By day" returns one page at a time, capped by entry count (about 100) rather
      than by days, so "Everyone" in a large organization stays bounded. The paging is
      recorded in `docs/architecture.md`.
- [ ] Opening Reports with cached data stays under 50 ms of main-thread work at 1×, measured
      as in task 053 for a month by project with many projects, with the 4× figure recorded
      here. If the timesheet's cell buttons push it over, only row names and column headers
      become buttons.
- [ ] Tests cover the grouping, the "By description" merge, the narrowing, and that a lead
      sees only their teams' entries
- [ ] The Reports row in `docs/product.md` lists the entries
