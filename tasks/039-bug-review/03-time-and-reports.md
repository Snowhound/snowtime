# 03: Time and reports

Status: todo

Totals depend on time zones, week starts, and entries that cross midnight, which the
seeded data covers only partly.

## Acceptance criteria

- [ ] Days, weeks, and ranges follow the user's time zone and week start, including
      across daylight saving changes
- [ ] Entries that cross midnight or a range boundary are split or counted as
      documented, in the timer list, summary, reports, and exports
- [ ] Range queries include every overlapping entry under the 24-hour bound, including
      the running timer
- [ ] Report totals, the timesheet, and CSV and XLSX exports agree for the same filters
      and scope
- [ ] Date and time input accepts the formats the settings allow and rejects impossible
      values without data loss
