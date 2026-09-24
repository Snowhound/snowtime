# How Snowtime was designed

As of 2026-09-24.

Snowtime is a Toggl-style time tracker for Snowhound that can also host other
organizations. This document traces how its design took shape across 54 commits on
`main`. For the current decisions, see [architecture.md](architecture.md).

The account draws on the commit history, changes to the product, architecture, hosting,
and migration docs, and the task files, including the archive. Surviving Claude Code
prompts cover the initial stack choice and the later UI work. For the sessions between
them, the commits and doc changes are the record.

## How the work was organized

The repo began with the official TanStack Start scaffold:

```bash
bun create @tanstack/start@latest snowtime
```

The initial stack was Solid, the file router, TypeScript, Tailwind, and Bun. The scaffold
included Vercel, Better Auth, TanStack Query, TanStack Form, Solid-UI, and T3 Env add-ons.
The first prompt asked Claude to record those choices without adding speculative ones.
It produced three kinds of working documents:

- `docs/architecture.md` records technical decisions and their reasons.
  `docs/product.md` sets MVP scope; `docs/hosting.md` records Vercel and Turso limits;
  `docs/migrations.md` governs schema changes.
- `tasks/` holds one file per task, with a status and acceptance criteria. Larger tasks
  have numbered subtasks: task 006 covers server-function areas, and task 023 covers
  views in build order. Completed tasks move to `tasks/000-archive/`.
- `AGENTS.md`, added in the first commit, directs agents to these records. A change that
  contradicts a recorded decision must update the doc in the same change or stop to ask.

Claude Code agents worked from these files. Tasks were sometimes filed as a batch for
the next stage; one commit filed tasks 006–012 alongside their data conventions. The
`google-style` writing skill was added early to keep docs consistent across sessions.

UI work began with static HTML prototypes. Task 013 covered every MVP view before its
Solid implementation. The prototypes used Solid-UI class strings so their markup could
be ported into components. Layout variants sat side by side until one was chosen: cards
for sign-in, for example, and a timesheet for reports. The `ui-review` skill checked
each view in a browser at 1440, 850, and 390 px, in light and dark, across fixture
states and with keyboard access. The prototype engine and review skill came from the
minupatsient projects, as did parts of the Drizzle and migration setup. DBML diagram
generation came from earlier tender projects.

Later, two Claude sessions worked in parallel, one on the server and one on the UI.
Their handoff prompts named the docs, completed tasks, and file ownership. When both
claimed task 021, the UI session backed off and the server session took 022. A separate
security review filed gaps as task 024.

Checks were added for conventions agents might otherwise drift from: `db:verify`
checks applied migrations, `db:drift` compares the Drizzle mapping with migrations,
`datamodel:check` checks the diagram, and `icons:check` enforces icon names. CI runs
these checks on pull requests.

## Build sequence

The first three stages established the docs, prototypes, and data tooling. Server code
began in stage 4; Solid UI code began in stage 6.

| Stage                     | Commits | Work                                                                                                                                                                                |
| ------------------------- | ------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Ground rules           |       3 | Stack and conventions; organizations and teams from day one; team leads; a possible dedicated deployment per client.                                                                |
| 2. Data model and tooling |       6 | HTML prototype setup and first timer prototype; DBML and ChartDB; SQL-first migrations on Drizzle v1; audit columns and logical delete; tasks 006–012.                              |
| 3. Schema and sign-in     |       7 | Writing skill; initial migration and actor context; sign-in prototype; Better Auth on Turso; no-email MVP and local-only password sign-in.                                          |
| 4. Server layer           |      13 | Session and scope middleware; tenancy, soft-delete, and seed helpers; timer, entry, project, and settings functions; server i18n readiness, team roles, and project deletion rules. |
| 5. Reports and prototypes |       8 | Time-zone-aware reports; reports, organization admin, and projects prototypes; passkeys; DBML generated from the schema.                                                            |
| 6. UI foundation          |       8 | View subtasks; GitHub and Microsoft sign-in; CI; Paraglide in English and Estonian; Solid-UI components, SSR query hydration, and component tests; project rename.                  |
| 7. Parallel build         |       5 | oxlint and oxfmt; security review and timer stop on member removal; app frame, sign-in screens, and icon-name check.                                                                |

## Choices that shaped the design

Three constraints drove many early choices: the Vercel and Turso free tiers, SQLite's
lack of row-level security, and support for multiple organizations in one deployment.

**Tenancy and access.** Snowhound has several teams, so the design adopted
organizations and teams rather than leaving tenancy for later. A shared database per
environment keeps the database count low; `organization_id` separates tenants on each
row. A client can still have a dedicated stack because instance-specific settings come
from environment variables. Better Auth's organization plugin manages organizations,
teams, members, and invitations, using its own admin and owner checks. An app-level
team-lead role lets leads see their team's time without making them organization admins.
Server functions enforce authorization for app data because SQLite has no row-level
security. Writes use named mutations rather than generic CRUD.

**Data and time.** Client-generated UUIDv7 text keys allow optimistic inserts without
a round trip. Timestamps are UTC epoch milliseconds. A running timer is an entry with
no stop time, and a partial unique index allows one per user. The client computes
elapsed time, avoiding scheduled writes against the Turso quota. For reports, one
tested server module computes day and week boundaries in the user's time zone.
Hand-written SQL migrations are the source of truth because Drizzle generation loses
SQLite details such as partial indexes and composite keys. The Drizzle schema is a
checked mapping. Migrations roll forward; applied files stay unchanged, and CI runs
them instead of the Vercel build. Request middleware supplies the actor for audit
columns because SQLite triggers have no session context. App tables use logical delete;
GDPR erasure anonymizes users, and organization deletion is disabled to preserve
history and reports. Business rules live in TypeScript modules that receive the
database and scope, which lets tests use seeded throwaway databases. Local-first sync
and Postgres remain deferred, each with a condition for revisiting it.

**Sign-in.** The MVP sends no email. OAuth supplies the verified addresses needed for
invitations, and admins share invitation links themselves. Password sign-in is limited
to seeded users in local development because production passwords would require
verification and reset email. Google, GitHub, and Microsoft are enabled when their
environment variables are set; passkeys attach to existing accounts. Brevo is the
later email choice; Resend was considered.

**UI and language.** The server returns keys, dates, and numbers; the client translates
and formats them for the user's locale and time zone. Paraglide supports English and
Estonian from the first view, with the locale in a cookie because there are no public
pages needing localized URLs. User theme, layout, and language settings live on the
server so the first render uses the right theme. Solid-UI class strings in prototypes
make porting direct. oxlint and oxfmt were chosen after comparison with Biome; the
project uses no Prettier.

## Changes along the way

Fifteen decisions changed during the build. The docs changed with the code, so they
record the current choice; the commits retain the earlier one.

| Area                 | Change                                                                                                         | Reason                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Tenancy              | An open question about workspace scope became organizations and teams from day one.                            | Snowhound needs teams, and other companies are a goal. This was settled in the second commit. |
| Prototype components | Basecoat gave way to Solid-UI's own class strings.                                                             | Basecoat only approximated Solid-UI.                                                          |
| Data model diagram   | Hand-written DBML became generation from `schema.ts`, checked in CI.                                           | A hand-kept diagram could drift.                                                              |
| Env validation       | The scaffold's T3 Env validator gave way to Valibot.                                                           | Valibot already serves forms and server functions.                                            |
| Email and passwords  | Password sign-in with reset email became no email in the MVP and local-only passwords; Brevo was deferred.     | There was no need to run an email provider yet.                                               |
| View settings        | `localStorage` gave way to server-side `user_settings`.                                                        | The server can render the correct theme on first paint.                                       |
| Team management      | Planned server functions for team writes gave way to Better Auth's client; server functions handle team roles. | Wrapping plugin writes duplicated its checks.                                                 |
| Branding             | Snowhound wolf and pack illustrations were removed; the tagline stayed and the logo task was postponed.        | The company marks did not fit the product.                                                    |
| Server entry         | `src/server.ts`, first thought required by Start, became `src/server-entry.ts` through Vite config.            | The user requested the rename, and the entry proved configurable.                             |
| Member removal       | Removing or leaving a member now stops their running timer in that organization.                               | The security review found the gap (task 024).                                                 |
| Dev sign-in          | A long notice became a short “DEV users” list that fills in credentials.                                       | The notice was too long for a development helper.                                             |
| Icon names           | A proposed prefix became an `Icon` suffix, enforced by a script.                                               | JSX makes icons recognizable, and the check keeps names consistent.                           |
| Project name         | `snowtime-slop` became `snowtime-kaitk`, then `snowhound-kaitk`.                                               | Naming cleanup across files and folders.                                                      |
| Linting              | oxlint and oxfmt were added in stage 7.                                                                        | The initial stack omitted them.                                                               |
| Import paths         | A rule requiring the `~/` alias throughout `src/` was reverted; only `scripts/` and `datamodel/` must use it.  | Relative imports read better inside `src/`; `../src/` from outside it does not.               |

Linting and formatting arrived after much of the code; on a new repo, they would belong
with the stack choices. Later rules came from the minupatsient configs, taken selectively
rather than wholesale: function declarations over arrow constants, sorted imports, regex
backtracking checks, and a pre-commit hook. The import-path rule shows the limit of
copying: minupatsient's alias convention fit only the code outside `src/`. The
icon and diagram changes show another recurring response: when a correction was easy
to lose in later agent sessions, it became a script check.

## State on 2026-09-24

The data model, server rules, and MVP prototypes are done. Building the views and
setting up real environments remain.

| Work                                        | Status on 2026-09-24                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Task 023, app UI                            | App foundation, frame, and settings done; timer and layouts, projects, reports, organization views, and the Estonian pass remain. |
| Lint and format                             | Done, with a pre-commit hook.                                                                                                     |
| Task 009, CI and environments               | In progress. Turso staging and production databases, the Vercel project, and migrations in GitHub Actions need account access.    |
| Tasks 012 and 014, i18n and component tests | Set up; close as the views land.                                                                                                  |
| Task 016, email delivery                    | Optional later work with Brevo, if email invitations or notifications are needed.                                                 |
| Task 017, logo                              | Postponed; it may never be made.                                                                                                  |

Three questions remain for an architect to assess:

- **Vercel plan:** Hobby is for non-commercial use. Snowhound's use is likely
  commercial, so Pro may be needed before production.
- **Preview OAuth:** Providers require exact redirect URLs. Generated preview URLs
  cannot use OAuth; the planned workaround is a stable staging host.
- **SQLite limits:** Postgres on Neon remains the fallback if time zones or reporting
  outgrow SQLite. Local-first sync remains deferred.
