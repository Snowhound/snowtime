# Snowtime

A minimal, multi-tenant time tracker in the spirit of Toggl. Snowhound built it for its
own teams, and it can host other organizations from the same deployment.

- One-click timer with a description and project
- Organizations, teams, members, and invitations, with owner, admin, member, and team
  lead roles
- Projects per organization, optionally assigned to teams
- Reports per day, week, project, team, and member in the user's time zone, with CSV and
  XLSX export
- Sign-in with Google, GitHub, Microsoft, or a passkey
- English and Estonian

The scope and what is left out on purpose are in [docs/product.md](docs/product.md).

## Stack

[TanStack Start](https://tanstack.com/start) with [Solid](https://www.solidjs.com),
[Turso](https://turso.tech) (libSQL) through [Drizzle](https://orm.drizzle.team),
[Better Auth](https://www.better-auth.com), [Solid-UI](https://www.solid-ui.com) with
Tailwind CSS, and [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs).
It is deployed to [Vercel](https://vercel.com). Each choice and its reason is recorded in
[docs/architecture.md](docs/architecture.md).

## Getting started

Requires [Bun](https://bun.sh) 1.3 or later.

```bash
bun install
bun run db:migrate
bun run db:seed
bun --bun run dev
```

The app runs on http://localhost:3000 against a local SQLite file, `local.db`. Put local
overrides, such as OAuth credentials, in `.env.local`; `.env.example` lists every
variable.

### Seeded users

`bun run db:seed` fills the local database with demo data (`src/db/seed.ts`). It refuses
any database that is not a local file. Every seeded user signs in with the password
`snowtime-local`; password sign-in is enabled only in local development.

| Email                | Name         | Role                                                                     |
| -------------------- | ------------ | ------------------------------------------------------------------------ |
| `owner@example.com`  | Olivia Owner | Owner of Northwind Studio                                                |
| `admin@example.com`  | Adam Admin   | Admin of Northwind Studio, owner of Harbor Consulting                    |
| `lead@example.com`   | Lena Lead    | Member of Northwind Studio, lead of Design                               |
| `member@example.com` | Max Member   | Member in Design, Engineering and Harbor's Delivery; has a running timer |
| `theo@example.com`   | Theo Lead    | Member of Northwind Studio, lead of Engineering                          |
| `mia@example.com`    | Mia Engineer | Member in Engineering, lead of Delivery in Harbor Consulting             |
| `noah@example.com`   | Noah Solo    | Member of Northwind Studio, in no team                                   |

To start over: `rm local.db && bun run db:migrate && bun run db:seed`.

## Scripts

| Command                      | What it does                                       |
| ---------------------------- | -------------------------------------------------- |
| `bun --bun run dev`          | Starts the dev server on port 3000                 |
| `bun run build`              | Builds for production                              |
| `bun run test`               | Runs server tests (`bun test`) and component tests |
| `bun run lint`               | Runs oxlint                                        |
| `bun run format`             | Formats with oxfmt                                 |
| `bun run db:generate <name>` | Creates an empty SQL migration                     |
| `bun run db:migrate`         | Verifies and applies migrations                    |
| `bun run db:drift`           | Compares the Drizzle schema with the migrations    |
| `bun run datamodel`          | Opens the data model in ChartDB (needs Docker)     |

## Database

The SQL migrations in `drizzle/` define the schema; they are written by hand, and
`src/db/schema.ts` follows them. Read [docs/migrations.md](docs/migrations.md) before
changing the schema. The data model, its diagram, and how to view it are in
[datamodel/README.md](datamodel/README.md).

## Deployment

Snowtime runs on Vercel with a Turso database per environment: `prod` for `main`, and a
planned `staging` for `develop`. The Vercel build and app start never apply migrations.
Until CI does, run `bun run db:migrate` with the target database's `TURSO_DATABASE_URL`
and `TURSO_AUTH_TOKEN` set.

1. Import the repository into Vercel. `vercel.json` selects the TanStack Start framework.
2. Under **Settings > Environment Variables**, set the variables from `.env.example`.
   Variables prefixed with `VITE_` reach the browser bundle, so keep secrets unprefixed.
3. Deploy.

The same codebase can also run as a dedicated stack per client, configured only through
environment variables. Free-tier limits and region choice are in
[docs/hosting.md](docs/hosting.md).

## Documentation

- [Product](docs/product.md): purpose, MVP scope, and tenancy
- [Architecture](docs/architecture.md): recorded decisions and their reasons
- [Hosting](docs/hosting.md): Vercel and Turso constraints
- [Migrations](docs/migrations.md): how to change the schema
- [Data model](datamodel/README.md): the DBML diagram and its conventions
- [Prototypes](prototypes/README.md): HTML prototypes of each view and the brand
- [Design process](docs/design-process.md): how the design took shape
- [Tasks](tasks/README.md): open work; finished tasks are in `tasks/000-archive/`

## Contributing

Code is grouped by feature in `src/features/` and by domain in `src/server/`. The
conventions are in [AGENTS.md](AGENTS.md). A pre-commit hook runs oxlint and oxfmt on
staged files, and CI checks formatting, lint, types, tests, and schema drift on every
pull request.

## License

[MIT](LICENSE). Third-party assets keep their own licenses; see
[prototypes/THIRD_PARTY_NOTICES.md](prototypes/THIRD_PARTY_NOTICES.md) and the font
license in `design/brand-assets/fonts/`.
