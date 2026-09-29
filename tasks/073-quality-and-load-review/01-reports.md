# 01: Reports load and data

Status: todo

## Acceptance criteria

- [ ] The Entries card's list loads only while the card is open, and never while the
      server renders the page; its count and total come without the list
- [ ] The cold Reports year document is no larger than its report needs, measured again
      with `temp/perf073/doc.mjs`
- [ ] By description returns a bounded first set of rows
- [ ] `getReportEntries` narrows to a timesheet row in SQL where the row maps to a column,
      and uses or drops `time_entry_organization_id_ticket_idx`
- [ ] The year report's ticket rows are built only when the report groups by ticket
- [ ] The export sends narrow entry rows without the Entries card's fields or a second
      `timeZone`; the owner's year export size is recorded against Vercel's 4.5 MB limit
      in `docs/hosting.md`
- [ ] A former member shows with their name in the timesheet, Breakdown, Entries card,
      and exports
- [ ] `GROUP_LABELS` and the share titles have one definition each
- [ ] The stale "suspends" comment in `reports-view.tsx` is gone
- [ ] The company seed takes its days off from `src/lib/holidays`
- [ ] `general-tab.tsx` passes its schemas to TanStack Form without `firstIssue`
