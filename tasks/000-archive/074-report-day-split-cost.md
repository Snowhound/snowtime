# 074: Report day-split cost

Status: done

The owner's year report on the Lumen Works seed takes about 345 ms on the server (task
073, 2026-09-29), most of the year page's ~407 ms. `aggregate` in
`src/server/reports/reports.server.ts` runs `splitByDay` (`src/lib/calendar.ts`) for each
of about 20,000 entries. Each call runs `localDate` and at least one `startOfDay`, and both
go through `Intl` in the organization's zone. The same split runs for the Entries card's
pieces (`piecesOf`) and the export. A likely fix is to work out the range's local
midnights once, about 370 `Intl` calls for a year, and place each entry against that table.

## Acceptance criteria

- [x] A CPU profile of `getReport` for the owner's year confirms where the time goes
      before any change: `splitByDay` held 82% of the samples, `formatToParts` alone 57%
- [x] The year report, the Entries card, and the export split entries without per-entry
      `Intl` calls, through `daySplitter` in `src/lib/calendar.ts`
- [x] Day totals are unchanged, including across a daylight-saving change and for entries
      that cross midnight, with tests for both
- [x] The owner's year report takes under 100 ms on local SQLite, measured with
      `temp/perf073/api.ts`: 326 ms before, 48 ms after. The year's Entries card by
      description fell from 324 to 64 ms and a year's export from 620 to 99 ms
