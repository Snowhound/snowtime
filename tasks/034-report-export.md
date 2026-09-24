# 034: Export reports as CSV and XLSX

Status: todo

Let a report be downloaded as CSV and XLSX, so hours can go into a spreadsheet or payroll.
`docs/product.md` lists "Exports beyond what is trivial" as not in the MVP. This is the trivial
export: the report as shown, in two formats. Update `docs/product.md` in the same change.

Try it in `prototypes/reports.html` first: where the Export button goes and what it offers.

## Acceptance criteria

- [ ] Reports has an Export menu with CSV and Excel (XLSX), for the current filters
- [ ] The file holds the timesheet as shown: a row per group, a column per day or week, and row
      and column totals, with durations as decimal hours (and h:mm in XLSX as a number format)
- [ ] A second sheet or CSV option lists the entries behind the report: date, member, project,
      description, start, end, and duration, in the user's time zone
- [ ] The file name names the organization and the range, such as
      `snowhound-2026-09-01-to-2026-09-30.csv`
- [ ] The export follows the same role rules as the report (`prototypes/README.md`), enforced on
      the server
- [ ] CSV is UTF-8 with a BOM so Excel opens non-ASCII names correctly, and cells starting with
      `=`, `+`, `-`, or `@` are escaped against formula injection
- [ ] The XLSX library choice and where the file is built (server function or client) are
      recorded in `docs/architecture.md`
