# 044: Reports load time

Status: in-progress

Opening Reports without cached data is slow on the server. The page waits on about 14
sequential Turso round trips, against about 6 for the timer, and each round trip is its
own HTTP request from the function to Turso. Counted from the code on 2026-09-25 for an
admin with Better Auth's cookie cache warm; not yet measured in production.

| Phase                                         | Sequential round trips                                    |
| --------------------------------------------- | --------------------------------------------------------- |
| Root `beforeLoad`: `getAppSession`            | 2 (memberships, then settings)                            |
| Loader: projects, teams and members, parallel | about 5 (`resolveScope` 2, then `listMembers` 3)          |
| Loader: `reportQuery`, after the three finish | 6–7 (`resolveScope` 2, settings, teams 2, users, entries) |

Causes:

- The loader computes the report input with `reportFilters`, which needs teams and
  members, so the report starts only after they load (`src/routes/_app/reports.tsx`).
- Every server function runs `resolveScope`: 2 sequential reads, 4 times per page load.
- `getReport` reads again what the page already has: `settingsOf` the session's
  settings, `reportTeams` what `listTeams` returned.
- Independent reads run one after another: `resolveScope`'s two, `listMembers`' three,
  and settings, teams and users in `reportData`.
- The route has no pending component and the loader awaits the report, so a click
  leaves the old page up until everything has loaded.
- `reportQuery` has no `staleTime`, so each visit refetches it; a full page load always
  runs the whole chain, because each server request starts with an empty QueryClient.

The queries themselves use indexes (`time_entry_organization_id_started_at_idx` and the
`user_id` one); the cost is the number of round trips, not slow SQL. A Vercel function
region that differs from the Turso primary region (`docs/deployment.md`) multiplies
every round trip.

## Acceptance criteria

- [ ] Server timings for `/reports` and `/timer` recorded before and after, per server
      function, on the deployed app
- [x] The Vercel function region and the Turso primary region confirmed to match
- [x] The report query starts together with projects, teams and members instead of
      after them. The route asks for the report the URL names (`requestedInput`); a
      member or team outside the user's choices is refused and the view asks for the
      narrowed report, and `filters.test.ts` checks the two agree for allowed choices
- [x] `getReport` reads settings, teams with their members (one join) and readable users
      in parallel, then the entries: 2 round trips after the scope instead of 5–6
- [x] `listMembers` and `listTeams` read their rows and the organization's team
      memberships in parallel: 1 round trip after the scope instead of 3 and 2
- [x] `resolveScope` runs its two reads in parallel: 1 round trip on every server
      function instead of 2
- [x] Following a link to any signed-in page opens it at once. A route whose loader
      waits on the server shows its pending component (the page's title and placeholder
      shapes) after 100 ms, for at least 300 ms (`src/router.tsx`). Reports reads its
      filters from the location instead of `loaderDeps`, so a filter change keeps the
      previous report on screen rather than showing the pending page
- [x] The report's access rules and results are unchanged: `reports.test.ts` and
      `reports-view.test.tsx` pass, and a browser check covered admin, team lead (with
      an allowed and a refused team link) and member
- [x] `docs/architecture.md` needs no change: the scope and report rules keep their shape
