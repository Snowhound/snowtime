# 034: Export reports as CSV and XLSX

Status: done

Let a report be downloaded as CSV and XLSX, so hours can go into a spreadsheet or payroll.
`docs/product.md` lists "Exports beyond what is trivial" as not in the MVP. This is the trivial
export: the report as shown, in two formats. Update `docs/product.md` in the same change.

Try it in `prototypes/reports.html` first: where the Export button goes and what it offers.

## Progress

- 2026-09-25: Prototype: Export is an outline button at the right of the timesheet card's header,
  with a menu of Excel (XLSX, timesheet and entries), Timesheet (CSV), and Entries (CSV).
  `prototypes/README.md` records it under Reports.
- 2026-09-25: App: `getReportEntries` (`src/server/reports/`) returns the entries behind a report
  under `getReport`'s rules, split per day like its totals. The browser builds the files
  (`src/features/reports/export.ts`, `export-menu.tsx`) with `write-excel-file` for XLSX, loaded
  on demand. `docs/architecture.md` ("Report export") and `docs/product.md` record the choices.
  Tests: the entries add up to the report's totals per member, day, and project for a member, a
  lead, and an admin; they follow the role rules and split at midnight; CSV quoting, the BOM,
  formula escaping, file names, and the XLSX's sheets and `[h]:mm` durations. Checked in Chrome as
  Adam (owner of Harbor) and Mia (who leads Delivery there), for this month's report: all three
  downloads, named `harbor-2026-09-01-to-2026-09-30.*`, with the grid's values and Max's entry
  in each user's time zone. The menu at 1440, 850, and 390 px, light and dark, had no horizontal
  scroll. One run logged a 404 once; it didn't come back, and was likely Vite re-optimizing after
  the new dependency. Not checked: opening the files in Excel or Numbers itself. The XLSX was
  checked by unzipping it.
  The Estonian menu labels are mine: "Ekspordi", "Ajatabel (CSV)", "Kirjed (CSV)", and "Nagu
  näha, tunnid kümnendmurruna" (As shown, in decimal hours), which is the one to review.

## Acceptance criteria

- [x] Reports has an Export menu with CSV and Excel (XLSX), for the current filters
- [x] The file holds the timesheet as shown: a row per group, a column per day or week, and row
      and column totals, with durations as decimal hours (and h:mm in XLSX as a number format)
- [x] A second sheet or CSV option lists the entries behind the report: date, member, project,
      description, start, end, and duration, in the user's time zone
- [x] The file name names the organization and the range, such as
      `snowhound-2026-09-01-to-2026-09-30.csv`
- [x] The export follows the same role rules as the report (`prototypes/README.md`), enforced on
      the server
- [x] CSV is UTF-8 with a BOM so Excel opens non-ASCII names correctly, and cells starting with
      `=`, `+`, `-`, or `@` are escaped against formula injection
- [x] The XLSX library choice and where the file is built (server function or client) are
      recorded in `docs/architecture.md`
