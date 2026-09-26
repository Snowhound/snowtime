# 055: Entries on the Reports page

Status: todo

`docs/product.md` says team leads see their teams' entries. The Reports page only shows
totals, and the Timer page lists only the user's own entries. So a lead can't see in the
app what a member worked on in a week or month. The Entries CSV and the XLSX's second
sheet are the only way to see them.

An Entries card below the timesheet lists the entries behind the report for the same
filters (range, People, Group by). `getReportExport` already builds this list
(`ReportEntryPiece`), with the same permission checks. Keeping the card on the Reports page
lets one URL share both the totals and the entries.

## Acceptance criteria

- [ ] `prototypes/reports.html` shows the Entries card for a member, a team lead, and an
      admin, checked per `docs/skills/ui-review/SKILL.md`, before the app changes
- [ ] The card lists the report's entries grouped by day: a date heading with the day's
      total, then each entry's time span, description, project, and duration. A member
      column shows only when the selection covers more than one person.
- [ ] A "By description" view merges entries with the same description and project into
      one row with their total time and entry count. When it is the default (for example,
      for ranges longer than a week) is decided in the prototype.
- [ ] Choosing a timesheet row or cell narrows the card to that project, team, or member
      and that day or week. The narrowing lives in the URL, like the other filters.
- [ ] Entries are read-only in the card. Only the owner edits an entry, from the Timer page.
- [ ] The card and the export read the same server list, so they show the same entries,
      and a running timer counts the same in both
- [ ] A month of entries for a team loads without a noticeable wait; how the card pages or
      limits long lists is decided and recorded in `docs/architecture.md`
- [ ] Tests cover the grouping, the "By description" merge, the narrowing, and that a lead
      sees only their teams' entries
- [ ] The Reports row in `docs/product.md` lists the entries
