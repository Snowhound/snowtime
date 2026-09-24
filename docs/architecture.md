# Architecture

## Stack

| Concern         | Choice                                                    |
| --------------- | --------------------------------------------------------- |
| Framework       | TanStack Start with Solid; Vercel deployment adapter      |
| Runtime / PM    | Bun (local)                                               |
| Database        | Turso (libSQL/SQLite) via `@libsql/client`                |
| ORM             | Drizzle, SQLite dialect (`"turso"` in drizzle-kit)        |
| Auth            | Better Auth with the Drizzle adapter; organization plugin with teams |
| Data fetching   | TanStack Query with optimistic updates                    |
| Forms           | TanStack Form                                             |
| Validation      | Valibot, shared by forms and server functions             |
| UI              | Solid-UI + Tailwind                                       |
| i18n            | Paraglide JS (planned, not yet installed)                 |
| Client state    | No library; Solid signals/stores and URL search params    |

## Data conventions

- Primary keys: UUIDv7, stored as text, generated on the client.
- Timestamps: UTC epoch milliseconds (`integer({ mode: "timestamp_ms" })`).
- Running timer: a time entry with `stopped_at` NULL. A partial unique index
  enforces at most one running entry per user.
- Elapsed time for the running timer is computed on the client, never
  written periodically.

## Tenancy

- Model: Better Auth organization plugin with teams enabled
  (`organization`, `member`, `team`, `teamMember`, `invitation` tables).
- One shared database per environment; tenant isolation is row-level.
- Every tenant-owned table has a non-null `organization_id`; team-scoped rows
  (e.g. project assignments) also reference `team_id`.
- The active organization comes from the session. Every server function
  resolves it and checks membership and role before touching data; queries
  always filter by `organization_id`.
- Organization roles: owner / admin / member (plugin defaults).
- Team role: `lead` or `member`, stored per team membership. The plugin has
  no team roles, so this is an app-level field on team membership.
- Teams group people for access and reporting; data is owned by the
  organization, not the team.

| Role        | Own entries | Team members' entries  | All org entries |
| ----------- | ----------- | ---------------------- | --------------- |
| Member      | read/write  | —                      | —               |
| Team lead   | read/write  | read, reports          | —               |
| Admin/owner | read/write  | read/write, reports    | read/write      |

- One running timer per user, across all organizations.

## Deployment model

- Default: one shared multi-tenant deployment.
- Must remain possible: a dedicated stack per client (own Vercel project and
  Turso database) from the same codebase, with no code changes.
- Therefore: nothing tenant-specific in code (no hardcoded org names,
  domains, or branding); everything instance-specific comes from env vars;
  migrations apply cleanly to an empty database.

## Time zones

- Each user has settings with an IANA time zone (default from the browser
  via `Intl`) and a week start (Mon/Sun).
- The frontend converts UTC to the user's zone for display.
- Reports: day/week boundaries are computed in TypeScript on the server using
  the user's zone, then queried as UTC ranges. Aggregation happens in
  TypeScript; entries crossing midnight are split there.
- All of this lives in one tested `reports` module.

## Application rules

- All DB access goes through server functions; the Turso token never reaches
  the browser.
- Authorization checks live in server functions (SQLite has no RLS).
- Writes are named mutations (`startTimer`, `stopTimer`, `updateEntry`, …),
  not generic CRUD.
- Business logic lives in TypeScript, not DB triggers.

## Environments and deployment

| Environment | Database                                                   |
| ----------- | ---------------------------------------------------------- |
| Local       | `file:local.db`, no token                                  |
| Preview     | One shared `staging` Turso database                        |
| Production  | `prod` Turso database, same region as the Vercel functions |

**Migrations:** `drizzle-kit generate` output is committed to the repo.
`drizzle-kit migrate` runs in CI — staging on PRs, prod on merge to main
before promotion — never in the Vercel build. Prefer backward-compatible
migrations.

**Env vars:** `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BETTER_AUTH_SECRET`.

## Deferred / out of scope

- Local-first sync. If ever needed: Turso's own embedded replicas/sync.
  Postgres-based sync engines (Zero, ElectricSQL) are not compatible with
  Turso.
- Neon/Postgres remains the fallback if SQLite's time zone and reporting
  limits become a problem.
