# 074: Report day-split cost

Status: todo

The owner's year report on the Lumen Works seed takes about 345 ms on the server (task
073, 2026-09-29), most of the year page's ~407 ms. `aggregate` in
`src/server/reports/reports.server.ts` runs `splitByDay` (`src/lib/calendar.ts`) for each
of about 20,000 entries. Each call runs `localDate` and at least one `startOfDay`, and both
go through `Intl` in the organization's zone. The same split runs for the Entries card's
pieces (`piecesOf`) and the export. A likely fix is to work out the range's local
midnights once, about 370 `Intl` calls for a year, and place each entry against that table.

## Acceptance criteria

- [ ] A CPU profile of `getReport` for the owner's year confirms where the time goes
      before any change
- [ ] The year report, the Entries card, and the export split entries without per-entry
      `Intl` calls, or the profile shows why that isn't the cost
- [ ] Day totals are unchanged, including across a daylight-saving change and for entries
      that cross midnight, with tests for both
- [ ] The owner's year report takes under 100 ms on local SQLite, measured with
      `temp/perf073/api.ts`
