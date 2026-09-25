# 04: Client state

Status: done

Stale or leaked query data shows the wrong organization's or user's data without any
server fault.

## Acceptance criteria

- [x] Switching organization, signing out, and signing in as another user drop the
      previous data (`src/lib/session.ts`)
- [x] Every mutation invalidates or updates the queries that show its data, including
      in other open views
- [x] Solid reactivity: no prop read once where it must stay live, no effect that
      loops, and no hydration mismatch between server and client rendering
- [x] Failed mutations show an error and leave the UI in a consistent state
- [x] Every localStorage access is guarded, and the app works with storage blocked

## Findings

Reviewed on 2026-09-25 by reading the code, with component tests, and with Chrome
(Playwright) against the dev app as Max Member, who belongs to Harbor and Northwind.

### Fixed

- Switching organization showed and cached one organization's data as the other's. The
  switcher called `invalidateQueries()` after `setActive`, which refetched the old
  organization's queries against the new session and stored Harbor's projects under
  Northwind's key. In Chrome, the Projects list showed the other organization's projects
  for about 50 ms on each switch, and a switch back opened on them until the refetch. The
  switcher now removes the old organization's queries (`forgetOrganization`), and a
  refused switch stays put and reads the session again (`app-header.test.tsx`).
- A sign-out in another tab, or an expired session, left the user's data in this tab's
  cache, where the next user to sign in saw it: projects, teams, members, reports, and
  passkeys are keyed without the user, and the running timer without either. The root's
  query client now resets every other query when the session's user changes
  (`followSessionUser`, `session.test.tsx`).
- Reports and the Projects view's totals kept old numbers after a timer write, since no
  timer mutation touched `['report']` and the report stays fresh for 30 seconds. In
  Chrome, an entry lengthened from 2:00 to 2:15 still showed as 2:00 in Reports. Timer
  writes, and changes to who is in a team, now mark the reports stale through
  `optimistic`'s new `invalidate` option (`queries.test.tsx`).
- `useCreateEntry` added the new entry to every cached entry list, whatever its
  organization, user, or range; another organization's list showed it until that list
  refetched on opening. `cacheUpdate` now passes each query's key, and the entry joins only
  the lists it belongs in. Stopping a timer showed it ending now until the refetch, while
  the server ends it at most 24 hours after its start; the optimistic stop now does the
  same (`queries.test.tsx`).
- A new profile name took up to 5 minutes (`ORGANIZATION_STALE_TIME`) to reach the member
  lists in Organization and Reports. Saving it now refetches them (`profile-card.test.tsx`).
- The Appearance popover and the auth pages' Appearance menu rolled a refused change back
  without a word. Both now show the error (`appearance-popover.test.tsx`).

### Tracked

- Task 049: tabs share the session's active organization. After tab 2 switches, tab 1
  keeps its header until its session refetches, while its refetches store the other
  organization's data under its keys and its writes go to the other organization.
  Reproduced in Chrome: tab 1 listed Northwind's entries under Harbor.
- Task 050: `seasonByMonth` reads the month in the runtime's zone, UTC on Vercel, so for
  a few hours at the start of March, June, September, and December the server and browser
  render different seasons. Solid keeps the server's text on hydration, so the taglines
  stay on the server's season.

### Checked and sound

- Sign-out: the header and create-organization sign-outs call `forgetSignedInUser`. The
  invitation page's sign-out keeps the cache, which the next user's sign-in now resets. Provider sign-in returns with a full page load and a new cache. Accepting an
  invitation and creating an organization run outside the app layout, so no
  organization-scoped query is in use when the active organization changes; the old
  organization's cached data stays right for it.
- Query keys: every organization-scoped key holds the organization's id second
  (projects, teams, members, invitations, reports, entries, first entry), and pages mount
  their view keyed by organization, so a switch remounts it. The running timer (`['timer']`)
  spans organizations by design; `['app-url']`, `['sign-in-methods']`, and
  `['invitation', id]` hold no user data.
- Other open views: projects, teams, and members live in shared caches that Timer,
  Reports, Projects, and Organization all read, so a change in one shows in the others at
  once. An entry moved to other days stays in its old list until the refetch that follows
  the write.
- Settings in two tabs: `updateSettings` saves a partial patch, so a stale tab overwrites
  only the field it changes. It shows the other tab's changes when its session refetches
  on focus.
- Rollback: `optimistic` restores every snapshot on error; Timer, Projects, Organization,
  Preferences, and the sign-in methods show the error.
- Reactivity: props read once are either `initial<Name>`, read inside a view mounted with
  a keyed `Show` (entry popover, project and team dialogs, organization view), or copied
  into a signal that an `on(...)` effect keeps in step (entry fields, date and time
  inputs, calendar). The timer's clock and midnight effects set `now` only from timers.
  No effect writes a signal it tracks.
- Hydration: queries that run only in the browser (`enabled: !isServer`) render the same
  empty state on both sides. The passkey prompt, device settings, the time zone list, and
  the intro check read the browser in `onMount`. The running timer's text starts at the
  server's second and ticks within a second.
- Storage: every `localStorage` access in `device-settings.ts`, `intro.ts`, the passkey
  prompt, and the head script is in a `try`. With `localStorage` and `sessionStorage`
  throwing, as Chrome's "Block all cookies" makes them, the sign-in page, Timer, Reports,
  Projects, and Settings load without an error. `document.cookie` (`locale-cookie.ts`)
  reads as empty, rather than throwing, when cookies are blocked.
- The passkey prompt shows "Passkey added" only after `addPasskey` resolves without an
  error, and Better Auth's client returns an error for a cancelled or failed ceremony.
  The "Passkey added … Done" seen during subtask 03 didn't come back; it most likely came
  from the other session's edits to the prompt, which hot reload sends to every open tab.

### Accepted

- With storage blocked, the intro plays on every full page load, since nothing can record
  that it played. It can be skipped, and the Intro setting turns it off.
- A sign-out whose request fails still clears this tab and opens the sign-in page, while
  the cookie may stay valid, so the next page load can come back signed in.
