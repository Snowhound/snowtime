# 070: Timer page redraws after each write

Status: done

After each entry write on the Timer page (a row edit, a calendar move), the page's nodes were
removed and put back a few times within about 50 ms, which dropped focus and reset scroll
positions inside the page.

Cause: Solid Query's `useQuery` restarts its Solid resource on every cache update. A component
that read `data` before the resource's first load finished keeps a computation that then
counts each restart as pending, so the route's `Suspense` boundary shows its fallback and the
page again (TanStack/query#9955). Components now read queries through our own `useQuery`
(`src/lib/queries/use-query.ts`), which never suspends ("Application rules" in
`docs/architecture.md`).

Checked in the dev app on 2026-09-29: Alt+arrow moves and a list save keep focus and the
calendar's scroll, and no page node leaves the document. The app frame still leaves and
re-enters once while the page opens after sign-in, before anything can have focus.

## Acceptance criteria

- [x] The cause is found, and a write no longer moves the page's nodes
- [x] A list row keeps focus on its field across a save, as `prototypes/README.md` records
- [x] The calendar's focus and scroll workarounds are removed, and its focus still holds
