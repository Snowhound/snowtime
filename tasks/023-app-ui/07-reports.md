# 07: Reports

Status: todo

Day and week totals in the timesheet layout (02 · Timesheet, the selected variant).
Prototype: `prototypes/reports.html`.

## Acceptance criteria

- [ ] Filters: range preset, previous and next, from and to dates, People, Group by, and
      totals per day or week; ranges over 35 days switch to weeks
- [ ] The filters live in URL search params, so a report can be reloaded and shared
- [ ] Timesheet grid from `getReport`: a row per group, a column per day or week, row and
      column totals, today's column shaded, and a sticky first column when it scrolls
- [ ] People and Group by options follow the role table in `prototypes/README.md`
- [ ] The subtitle names the zone and week start and links to Settings
- [ ] Empty and long-content states
