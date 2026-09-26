# 05: Needless complexity

Status: in-progress (three proposals await a decision)

Look for code that exists only to support a design choice that could change, as the
shared active organization did before task 052. Such a change removes more code than
any local cleanup.

## Acceptance criteria

- [x] Wrappers, factories, options, and generic helpers with a single caller or a
      single variant are inlined
- [x] State kept in two places (URL and signal, query cache and store, server and
      client) has one source, or a stated reason for both
- [x] Each server domain's layers (`*.functions.ts`, `*.server.ts`, schemas) carry
      their weight; none only forwards to the next
- [ ] Larger simplifications are done, split into reviewable commits, with the
      decisions they change updated in `docs/architecture.md`

## Findings

Changed:

- `docs/architecture.md`, "Application rules", still said that switching organization
  removes the old one's queries, and that the server answers for the session's
  organization. Both stopped being true with task 052. The paragraph now says each
  organization's data sits under its own keys and points to "Tenancy". Two server comments
  that said "no active organization" now say "no organization".
- The Organization view's mutations restated the keys of `membersQuery`, `teamsQuery`,
  and `invitationsQuery`, and `['session']`. They now take them from the queries, so the
  keys can't drift apart.
- `useDeleteEntry` updated the earliest-entry cache with a no-op so it would refetch; it
  now lists that key in `invalidate`, which says what it means.
- `useInAppFrame`, a one-line wrapper around `useContext` with one caller, is gone: the
  status page reads `InAppFrame` directly.

Checked and sound:

- Props that no caller passes on shared components (`DatePicker` and `Calendar`'s `min`,
  `Calendar`'s `class`) stay: they are the fields' natural API and cost a line each
  (decided on 2026-09-26). The single-variant rule covers feature code, not these.
- Other single-caller exports (about 40, found by a script) are named domain helpers with
  their own tests or a reason for their name (`dayRange`, `resolveRange`, `photoUrl`,
  `teamChanges`), not wrappers.
- Server layers: each `*.functions.ts` picks a middleware, validates, and calls the rule,
  as "Application rules" decides; the rules take the database and scope so tests run them
  directly. No `*.server.ts` function only forwards. `scope.server.ts` and
  `queries.server.ts` are each used by every domain.
- State in two places, each with a stated reason: the device's settings copied from the
  account (signed-out pages, "User settings"); the timer bar's and entry rows' drafts,
  which copy a saved value only when it changes, so a refetch doesn't overwrite typing;
  the timer view's "Saved" ids, kept above the rows because a new date moves an entry to
  another day; the route context's session (for loaders) and the session query (for
  views that must follow a saved setting); the report filters, which live only in the URL.
- The `*Page` components read the session query so settings and renames show at once, and
  key the view by organization; the tests render the views with plain props.

Proposals (not started; each changes a recorded decision or the product):

1. Settings created with the user. `session.settings` is null until the app frame's first
   `getSettings` call sends the browser's time zone. That costs `getSettings`,
   `GetSettingsInput`, the frame's `onMount`, three pages' `Show` guards with `settings!`,
   two `?? 'UTC'` fallbacks, three loaders' `zone &&`, and `updateSettings`' missing-row
   branch: about 40 lines. The server can't know the zone at sign-up, so removing them
   needs another source for it (a first-run redirect, or a default the user corrects).
   Recommendation: keep, unless one of those is acceptable.
2. Project delete without the wait. The 500 ms delay in `optimistic`, the
   `deleteProjectKey` mutation state, and the rows' pending look (about 35 lines) exist
   because the server refuses a project with entries. If `listProjects` returned whether
   each project has entries, the view could offer "Archive instead" before asking the
   server, and delete would be a plain optimistic update. It costs an `EXISTS` per project
   in the list query and changes the "Application rules" decision.
3. The Table layout. `entry-table.tsx` (173 lines) and the row helpers `entry-list.tsx`
   exports for it lay out the same fields as the Bar layout's rows. It's a product choice
   from the prototype, so only you can drop it.

No change of the size of task 052's was found: the remaining code follows decisions that
still hold.

Candidates from earlier subtasks:

- `team-dialog.tsx` and `project-dialog.tsx` repeat the dialog shell that keeps the last
  target while it animates closed, and the name field with its uniqueness check (subtask
  04, found by `jscpd`). A shared component would be a new abstraction, so it needs
  agreement first.
- `parseOrganizationInput` in `src/server/schemas.ts` has one caller, `scopeMiddleware`, but
  stays, with its own test (decided on 2026-09-26).
