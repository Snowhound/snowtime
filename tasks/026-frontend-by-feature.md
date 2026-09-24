# 026: Frontend code by feature

Status: done

Arrange frontend code by feature, as minupatsient-front does, instead of by kind
(`src/components/<view>/` beside view code in `src/lib/`). A route file stays nearly empty
and imports its view. Each feature keeps its components, queries, mutations, helpers, and
tests together, so one folder holds everything a change to that view touches. Only code
used by several features goes in `src/lib/` (or a shared components folder).

Features live in `src/features/<name>/`. Folders beside the routes, which TanStack Router
skips when their names start with `-`, were rejected: auth spans three routes and the app
frame belongs to a layout route, so features don't map one to one onto route files.

The backend was grouped by domain in the same change (`src/server/<domain>/`), replacing
the parallel `src/functions/`, `src/schemas/`, and `src/server/` trees.

## Acceptance criteria

- [x] The layout decided (`src/features/`) and recorded in `AGENTS.md` under "Code
      conventions": what goes in a feature, what goes in `src/lib/`, and when a component
      gets its own subfolder
- [x] Route files only wire the route (loader, head, search params) and render the
      feature's page
- [x] Timer, settings, auth, and the app frame moved; `src/lib/` keeps only code that
      more than one feature imports, generic helpers, and code shared with the server
- [x] Solid-UI components stay in `src/components/ui/`, where the registry copies go
- [x] Server code grouped by domain, with the client's allowed imports recorded in
      `docs/architecture.md` ("Application rules")
- [x] Views built after this task (023 subtasks 05 to 08) follow the layout: task 023's
      description points to it
