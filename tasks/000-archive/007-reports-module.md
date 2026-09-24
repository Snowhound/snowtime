# 007: Reports module

Status: done

The one tested `reports` module from `docs/architecture.md`: day and week boundaries
in the user's zone, queried as UTC ranges, aggregated in TypeScript.

## Acceptance criteria

- [x] `bun test` set up
- [x] Day/week range computation for a zone and week start, including DST transitions
- [x] Entries crossing midnight split across days
- [x] Running entry counted up to "now"
- [x] Totals per day, week, project, team (current members) and member
- [x] Report queries respect role visibility (via task 005)
