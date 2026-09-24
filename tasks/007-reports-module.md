# 007: Reports module

Status: todo

The one tested `reports` module from `docs/architecture.md`: day and week boundaries
in the user's zone, queried as UTC ranges, aggregated in TypeScript.

## Acceptance criteria

- [ ] `bun test` set up
- [ ] Day/week range computation for a zone and week start, including DST transitions
- [ ] Entries crossing midnight split across days
- [ ] Running entry counted up to "now"
- [ ] Totals per day, week, project, team (current members) and member
- [ ] Report queries respect role visibility (via task 005)
