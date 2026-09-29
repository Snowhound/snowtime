# 068: Report on one project for a client

Status: done

Snowhound wants to send a client the report of that client's project straight from Snowtime,
as it does now from Clockify's detailed report. Reports can't narrow to a project, so the
export holds every project's time. For each project the client needs at least each entry's
description, member, date, and duration.

A Project select replaces the Ticket field in the filter bar: the team finds a ticket search
of little use next to a project pick. Group by ticket, and the Entries card's ticket rows,
stay. The export reads as a file for a client: English whatever the UI language, no "(you)"
after the user's name, the member's email, decimal hours next to h:mm, and entries sorted by
project, then date.

Try the filter in `prototypes/reports.html` first.

## Progress

- 2026-09-29: Prototype: Project, 8rem like the Ticket field it replaces, keeps the filter row
  on one line at 1440 px with about 16 px to spare; `prototypes/README.md` records it.
- 2026-09-29: App: `projectId` in `ReportInput` (a project's ID or `none`) replaces `ticket`;
  `?project=` holds it. The export names rows for a client (English, no "(you)"), adds Email,
  sorts by project, and adds Hours to the XLSX's entries. Tests: the server filter and its
  role rules, the Project select's options and URL, the entries' columns and order, and an
  Estonian UI exporting English files. Checked in Chrome as Adam (owner of Harbor) and Mia
  (lead of Delivery): picking Audit narrows every view, and the XLSX and both CSVs hold only
  its entries, with the new columns. No console errors; no horizontal scroll at 390 px. Not
  checked: opening the files in Excel or Numbers. Open: the `(organization_id, ticket)` index
  was for the ticket filter, and only Group by ticket reads the column now.

## Acceptance criteria

- [x] The filter bar has a Project select in place of Ticket: all projects, "No project", the
      active projects, then archived ones, for every role
- [x] `?project=` holds the pick, a project's ID or `none`; `?ticket=` goes, and an old link
      with it opens the report for all tickets
- [x] `getReport`, `getReportBreakdown`, `getReportEntries`, and `getReportExport` narrow to
      the project under the same role rules, so every view, the Entries card, and the export
      agree
- [x] The export's headers, sheet names, and "No project", "No team", and "No ticket" rows are
      English; member names have no "(you)"
- [x] Entries in the export have the member's email and are sorted by project, then date,
      member, and start; the XLSX has decimal hours next to h:mm
- [x] The XLSX's first sheet, and the menu's first CSV, is the entries; the timesheet follows
- [x] `docs/architecture.md` ("Report export", "Ticket keys") and `prototypes/README.md`
      record the changes
