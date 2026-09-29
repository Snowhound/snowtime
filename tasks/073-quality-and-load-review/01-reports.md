# 01: Reports load and data

Status: done

## Acceptance criteria

- [x] The Entries card's list loads only while the card is open, and never while the
      server renders the page; its count and total come without the list
- [x] The cold Reports year document is no larger than its report needs, measured again
      with `temp/perf073/doc.mjs`
- [x] By description returns a bounded first set of rows
- [x] `getReportEntries` narrows to a timesheet row in SQL where the row maps to a column,
      and uses or drops `time_entry_organization_id_ticket_idx`
- [x] The year report's ticket rows are built only when the report groups by ticket
- [x] The export sends narrow entry rows without the Entries card's fields or a second
      `timeZone`; the owner's year export size is recorded against Vercel's 4.5 MB limit
      in `docs/hosting.md`
- [x] A former member shows with their name in the timesheet, Breakdown, Entries card,
      and exports
- [x] `GROUP_LABELS` and the share titles have one definition each
- [x] The stale "suspends" comment in `reports-view.tsx` is gone
- [x] The company seed takes its days off from `src/lib/holidays`
- [x] `general-tab.tsx` passes its schemas to TanStack Form without `firstIssue`
- [x] Summary's share rows and Breakdown's top-level rows are one `ShareRow`, and both narrow
      the Entries card from a row's total
- [x] The export fetches its entries a calendar month at a time, every piece counted up to the
      first piece's moment, with its progress in the Export menu; the owner's largest piece is
      recorded in `docs/hosting.md`

## Findings

Measured on 2026-09-29 as the owner on the Lumen Works seed (19 people, 20,300 entries in the
year), local SQLite, production build (`vite build --sourcemap hidden`). Documents are the
median of five requests with `temp/perf073/doc.mjs`; JSON sizes come from `api.ts`, and the
export's size as sent from `export.mjs`.

| Measure                             | Before   | After    |
| ----------------------------------- | -------- | -------- |
| Year by week document               | 4,999 KB | 894 KB   |
| Year by week document, server time  | 814 ms   | 407 ms   |
| Year by week document, inline state | 2,256 KB | 49 KB    |
| Month document                      | 822 KB   | 415 KB   |
| Month document, server time         | 105 ms   | 57 ms    |
| Year report JSON                    | 309 KB   | 24 KB    |
| Year By description, first response | 1,860 KB | 20 KB    |
| Year export JSON                    | 8,590 KB | 5,123 KB |
| Year export as sent                 | 13.9 MB  | 7.8 MB   |
| Year export, largest piece as sent  | 13.9 MB  | 755 KB   |

- The Entries card now uses a non-suspending `useInfiniteQuery` (`src/lib/queries/use-query.ts`)
  enabled only while open. The server renders no list, so the entries are no longer in the
  page twice (Solid's resource and the query cache). The header's count comes with the report
  (`entries`); a chosen part gets its count from `getReportEntryTotals`.
- By description sends its top 25 rows and the row count; "Show all" loads the rest.
- A row narrows the read in SQL. The ticket index became
  `(organization_id, ticket, started_at)`, which SQLite picks for one ticket's range.
- Ticket totals come only with `tickets: true`, which the page sends when it groups by ticket;
  Breakdown's ticket pairs follow the same flag.
- The year export comes in 13 month pieces, the largest 755 KB as sent, well under Vercel's
  4.5 MB limit; all 13 total 8.1 MB, and the XLSX downloads in about 2.2 s.
- The year by week document's remaining 841 KB is the timesheet's own markup. The year report
  still takes about 345 ms on the server, most of it splitting entries by day.
- The seed's former member (Jaan Sepp, who left halfway through the year) is how the blank
  names showed; `getReport` now returns `formerMembers`.
