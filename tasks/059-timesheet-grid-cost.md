# 059: Timesheet cost with many rows

Status: todo

Opening Reports with cached data on a month by project with 40 projects takes 77–89 ms of
main-thread work at 1× before task 055's Entries card, and 89–98 ms with it (task 055,
Findings). Task 053's 50 ms limit held only for the seed's five projects. Each of the
grid's 1,200 cells renders a `Duration` (a `Show` and a `For`) inside a `TableCell` whose
classes go through `cn`, which runs tailwind-merge. Those are the first suspects.

## Acceptance criteria

- [ ] A profile of the cached visit names what the grid's time goes to
- [ ] Opening Reports on a month by project with 40 projects stays under 50 ms of
      main-thread work at 1×, measured as in task 055, with the 4× figure recorded
- [ ] The grid looks and reads the same, with the Entries card's buttons
