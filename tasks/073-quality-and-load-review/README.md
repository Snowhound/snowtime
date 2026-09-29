# 073: Quality and load review

Status: in-progress

A second pass over the code added since task 053 (`8f35490`, 2026-09-27), and a timing
check on the Lumen Works seed (`bun run db:seed --company`). A cold Reports year view sent
5 MB of HTML and took about 806 ms on the server, most of it for the Entries card, which
loads even while closed. The rest of the new code holds up, with about 350 lines of
repetition to remove. The Summary tab's overlap with the Timesheet and Breakdown is a
product question and stays out of scope.

Timings on 2026-09-29 (owner, local SQLite, production build): year report 332 ms and
309 KB, year Entries card by description 335 ms and 1.86 MB, year export 8.4 MB, Timer
page settled in 155–185 ms. The scripts are in the gitignored `temp/perf073/`.

## Subtasks

1. [Reports load and data](01-reports.md)
2. [Timer](02-timer.md)
3. [Scene and taglines](03-scene-and-taglines.md)

## Acceptance criteria

- [ ] Every subtask is done
- [ ] `bun run test`, `oxlint`, `tsc`, and `knip` pass
- [ ] `src/` has fewer lines than the 39,448 at `4a601e6`, counted as in task 053
