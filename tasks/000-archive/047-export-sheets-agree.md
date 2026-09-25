# 047: Export sheets from one read

Status: done

Task 039 found on 2026-09-25 that an XLSX export's two sheets can disagree. The export
menu (`export-menu.tsx`) builds the Timesheet sheet from the report already on screen,
counted up to that report's `now`, and the Entries sheet from a fresh
`getReportEntries` call, counted up to the export's. While a timer runs in the range, the
Entries sheet adds up to more than the Timesheet's total, by the time since the report
loaded. An entry edited in between (on another device, or by an admin) makes them differ
too. `docs/architecture.md` ("Report export") says the entries add up to the totals.

## Acceptance criteria

- [x] Both sheets come from one read with one `now`: `getReportExport` replaces
      `getReportEntries` and returns the report with its entries, and the XLSX's
      timesheet is that report
- [x] A test with a running entry in the range checks that the Entries sheet's durations
      add up to the Timesheet's total (`export-menu.test.tsx`)
- [x] The timesheet CSV stays the report as shown, and the entry list comes from
      `getReportExport`; `docs/architecture.md` ("Report export") says which `now` each
      uses
