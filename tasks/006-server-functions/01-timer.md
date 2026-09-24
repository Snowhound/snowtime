# 01: Timer

Status: todo

## Acceptance criteria

- [ ] `startTimer` (description, optional project); a running timer is stopped first in
      the same transaction (Toggl behaviour); the partial unique index guards races
- [ ] `stopTimer`
- [ ] `getRunningTimer` for the active user, across organizations
- [ ] Client-generated UUIDv7 accepted so optimistic updates keep their key
