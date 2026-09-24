# Architecture

## Stack

| Concern         | Choice                                                    |
| --------------- | --------------------------------------------------------- |
| Framework       | TanStack Start with Solid; Vercel deployment adapter      |
| Runtime / PM    | Bun (local)                                               |
| Database        | Turso (libSQL/SQLite) via `@libsql/client`                |
| ORM             | Drizzle, SQLite dialect (`"turso"` in drizzle-kit)        |
| Auth            | Better Auth with the Drizzle adapter                      |
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
