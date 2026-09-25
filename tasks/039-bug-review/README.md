# 039: Bug review

Status: todo

A review by Codex on 2026-09-25 found three real bugs that the tests missed: two
concurrent edits could make an entry longer than 24 hours, moving an entry could bypass
the daily entry cap, and closed invitation links still exposed the invitee's details
(fixed in `04e1ad7`). Review the rest of the repository for bugs of the same kinds, one
area per subtask, most important first.

For each finding, reproduce it, preferably as a failing test, then fix it or open a task
for it. Record areas checked and found sound in the subtask, so a later review can skip
them.

## Subtasks

1. [Security](01-security.md)
2. [Data integrity](02-data-integrity.md)
3. [Time and reports](03-time-and-reports.md)
4. [Client state](04-client-state.md)
5. [UX and UI](05-ux-ui.md)

## Acceptance criteria

- [ ] Every subtask is done
- [ ] Each confirmed bug is fixed with a test, or tracked in its own task
