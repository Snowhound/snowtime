# 024: Check membership on the running timer

Status: done

`stopTimer` and `getRunningTimer` use `sessionMiddleware`, because the running timer
spans organizations. They find the entry by `user_id` alone, and never check that the
user still belongs to the entry's organization. `startTimer` has the same gap: its
`stopRunning` call stops a running entry in any organization.

A user who is removed from an organization while their timer runs can still:

- read that organization's project name and color through `getRunningTimer`
- write `stopped_at` on that organization's entry through `stopTimer`, or indirectly by
  starting a timer in another organization

This breaks the rule in `docs/architecture.md` ("Tenancy") that every server function
checks membership before touching data. The fix must keep one running timer per user
across organizations.

## Acceptance criteria

- [x] The running-timer lookup in `src/server/timer.server.ts` joins `member` on the
      entry's `organization_id` and the user, so the three functions ignore an entry in
      an organization the user has left
- [x] Decide what happens to that orphaned running entry: stop it when the member is
      removed, or leave it for an admin. Record the decision in `docs/architecture.md`
- [x] `startTimer` still succeeds when such an entry exists; if the partial unique index
      `time_entry_one_running` blocks the insert, handle that case as decided. Decided:
      the removal hook stops the entry, so none remains; if the hook ever fails,
      `startTimer` returns `CONFLICT` with `timer_running_in_left_organization` rather than
      write to the other organization
- [x] Tests in `src/server/timer.test.ts` cover a user removed from an organization with
      a running timer: `getRunningTimer` returns null, `stopTimer` returns `NOT_FOUND`,
      and `startTimer` in another organization behaves as decided
