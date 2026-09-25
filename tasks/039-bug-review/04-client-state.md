# 04: Client state

Status: todo

Stale or leaked query data shows the wrong organization's or user's data without any
server fault.

## Acceptance criteria

- [ ] Switching organization, signing out, and signing in as another user drop the
      previous data (`src/lib/session.ts`)
- [ ] Every mutation invalidates or updates the queries that show its data, including
      in other open views
- [ ] Solid reactivity: no prop read once where it must stay live, no effect that
      loops, and no hydration mismatch between server and client rendering
- [ ] Failed mutations show an error and leave the UI in a consistent state
- [ ] Every localStorage access is guarded, and the app works with storage blocked
