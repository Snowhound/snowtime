# 01: Timer

Status: done

## Acceptance criteria

- [x] `startTimer` (description, optional project); a running timer is stopped first in
      the same transaction (Toggl behaviour); the partial unique index guards races
- [x] `stopTimer`
- [x] `getRunningTimer` for the active user, across organizations
- [x] Client-generated UUIDv7 accepted so optimistic updates keep their key
- [x] Checked over HTTP against the dev server: no active organization, invalid input,
      another team's project, start and stop
