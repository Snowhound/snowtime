# 05: Needless complexity

Status: done

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
- [x] Larger simplifications are done, split into reviewable commits, with the
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

Larger simplifications, decided on 2026-09-26:

- Project delete without the wait: task 056. `listProjects` says which projects have
  entries, so the view offers "Archive instead" before asking the server, and the `delay`
  option, `deleteProjectKey`, and the pending rows go (about 35 lines).
- Settings created with the user: kept. `session.settings` is null until the app frame's
  first `getSettings` sends the browser's time zone, which costs about 40 lines of guards
  and fallbacks. The server can't know the zone at sign-up, and the alternatives, a
  first-run redirect or a default the user must correct, are worse for the user.
- The Table layout: kept. It shares every field component with the Bar layout's rows; what
  repeats is the table's markup, and merging the two would make both harder to read.
- A shared team and project dialog: rejected. The shared part is the ~20-line shell that
  keeps its content while closing; the name checks differ (teams ignore case, projects
  point to an archived clash). The component would sit in `src/components/` for two
  callers and tie them together for little saving.

No change of the size of task 052's was found: the remaining code follows decisions that
still hold.

From earlier subtasks:

- `parseOrganizationInput` in `src/server/schemas.ts` has one caller, `scopeMiddleware`, but
  stays, with its own test (decided on 2026-09-26).
