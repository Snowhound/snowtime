# 04: Dead code and leftovers

Status: done

Unused code still gets read, searched, and kept up to date.

## Acceptance criteria

- [x] No unused files, exports, dependencies, or Paraglide messages; a tool such as
      `knip` finds them, and runs in CI if it's worth keeping
- [x] No debug logging, commented-out code, or stale `TODO`s left in `src/`
- [x] No prototype-only code in the app, and no app code copied back into `prototypes/`
      without need
- [x] Duplicated helpers merge into one

## Findings

Changed:

- A one-off `bunx knip` run (no dependency added) found these, now removed: the
  `@tanstack/solid-query-devtools` and `@tanstack/router-cli` dependencies from the
  scaffold, the unused `src/components/ui/progress.tsx`, and `formatTime` in
  `src/lib/format.ts`. 26 exports that only their own file used lose `export`.
- `SEASON_COPY`'s alternates and `PERIODS` in `src/lib/scene/seasons.ts` are unused too,
  but stay: task 054 shows them. Their comments point to it.
- `appSession` restated the 17 settings columns that `settings.server.ts` selects; it now
  calls `findSettings`, which returns `undefined` when there is no row rather than typing
  the missing row away.
- `FormAlert` in the auth feature and five inline copies in the Organization, invite,
  Projects, Timer, and Reports views became one `ErrorAlert` in
  `src/components/error-alert.tsx`. Kobalte's `Alert` already has `role="alert"`, so the
  explicit one went.

Checked and sound:

- Paraglide: every key in `messages/en.json` is read as `m.<key>` in `src/`, and
  `et.json` has the same keys.
- knip's remaining findings: exports of the Solid-UI copies in `src/components/ui/`,
  which stay as the registry has them; `prototypes/*.js` and
  `design/brand-assets/theme-tokens.css`, which HTML loads or docs cite;
  `src/server-entry.ts` and `csp.server.ts`, which `vite.config.ts` names as Start's
  entry; `PERIODS` (task 054). `tsr.config.json` stays: Start's route generator reads it.
- Logging: the `console` calls in `scripts/` are the scripts' output. In `src/`, the
  weather's `console.warn` reports a failed effect, and `connection.test.ts` prints
  `locked` to signal its child process. There are no `TODO`s, `FIXME`s,
  `debugger` statements, or blocks of commented-out code.
- Prototype code: the app has none. `src/db/seed.ts` is local demo data by design. The
  prototypes came first and simulate the app with their own fixtures; `ui.js` copies
  Solid-UI's classes, not app code.
- Duplication: a one-off `bunx jscpd` run found four clones. Two are merged (above). The
  Bar and Table entry rows lay out the same shared field components in a list and a
  table. `team-dialog.tsx` and `project-dialog.tsx` share their dialog shell and name
  field, recorded in subtask 05. Functions with the same name in different places
  (`isAdmin` on the server's `Scope` and on the client's role, `read`, `Row`,
  `EmptyState`, `setArchived`) do different things. The server can't import the
  client's `isAdmin`.

Open:

- knip in CI needs a `knip.json` that ignores `src/components/ui/`, `prototypes/`, and
  `drizzle.config.ts` (which fails without `TURSO_DATABASE_URL`), plus a dev dependency.
  With so few findings, a run at each review may be enough.
