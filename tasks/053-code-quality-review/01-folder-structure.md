# 01: Folder structure

Status: in-progress

A folder holding many unrelated files makes a change hard to scope. `src/lib/` has about
35 files that range from scene and weather code to session, members, and form helpers.

## Acceptance criteria

- [ ] No folder in `src/` mixes several unrelated concerns; related files that only
      share a folder move into a subfolder (for example the scene, weather, seasons,
      and intro files in `src/lib/` and `src/components/`)
- [x] Code in `src/lib/` or `src/components/` that only one feature uses moves into that
      feature, as `AGENTS.md` requires
- [x] Moves go in their own commit, listed in `.git-blame-ignore-revs`

## Findings

Changed:

- `scene.ts`, `scene.test.ts`, `weather.ts`, `seasons.ts`, and `intro.ts` moved to
  `src/lib/scene/`; `scene-layer.tsx`, `scenery-fields.tsx`, `season-tagline.tsx`, and
  `intro.tsx` moved to `src/components/scene/`. Paths in comments, `src/styles.css`,
  `docs/architecture.md`, `design/backgrounds/README.md`, and tasks 050 and 051 follow.
  The move is in `.git-blame-ignore-revs`.
- The shared queries (`session.ts`, `settings.ts`, `members.ts`, `projects.ts`,
  `teams.ts`, `passkeys.ts`, `sign-in-methods.ts`, `query.ts`) moved to
  `src/lib/queries/`, also listed in `.git-blame-ignore-revs`.
- `src/integrations/tanstack-query/provider.tsx`, one function in its own folder with one
  caller, is inlined into `src/router.tsx`.
- `src/lib/date-input.ts` pointed at `src/components/date-picker/`, which no longer
  exists; it now names `src/components/date-time/`.
- `AGENTS.md` says files serving one concern share a subfolder.

Checked and sound:

- Every file in `src/lib/` and `src/components/` has a user in two or more features, in
  another shared component, in the routes, or on the server. None belongs in a single
  feature.
- Feature folders: their files import each other across the folder (the timer's entry
  editor, popover, list, and table share `entries.ts`, `entry-fields.tsx`, and
  `queries.ts`), so no file has helpers only it uses that call for a component folder.
- `src/server/`: top-level files are cross-domain (errors, middleware, scope, rate limit,
  CSP); domains have their own folders. `src/db/` and `src/routes/` are as designed.

Left for a decision:

- `src/lib/queries/session.ts` combines the session query and cache watcher with the
  theme script and route and organization helpers. Its test also covers both cache and
  route behavior. Moving it into `queries/` grouped the query code but left unrelated
  behavior in that folder. Splitting the file would add a module; decide whether that
  organization is worth the extra file before marking the first criterion done.
