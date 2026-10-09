# Development

How to run Snowtime locally, the demo data, and the scripts. Code conventions are in
[AGENTS.md](../AGENTS.md).

## Getting started

Requires [Bun](https://bun.sh); `packageManager` in `package.json` pins the version CI
uses.

```bash
bun install
bun run env:init
bun run db:migrate
bun run db:seed
bun --bun run dev
```

The app runs on http://localhost:3100 against a local SQLite file, `local.db`.
`.env.development` sets the database and app URL, and `bun run env:init` adds the one
variable left, a generated `BETTER_AUTH_SECRET`, to the gitignored `.env.local`. Put other
local overrides, such as OAuth credentials, there too; `.env.example` lists every variable.

If the optimized glass cards show rendering artifacts on your machine, set
`VITE_GLASS_OPTIMIZATION=false` in `.env.local` to use live backdrop blur. The optimization
is on by default. Restart the dev server after changing this variable; production builds
read it at build time.

## Seeded users

`bun run db:seed` fills the local database with demo data (`src/db/seed.ts`). It refuses
any database that is not a local file. Every seeded user signs in with the password
`snowtime-local`; password sign-in is enabled in local development or with `DEMO_MODE=true`.

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

To call the HTTP API as a seeded user, sign in, create a key under Settings → API keys,
and use the Bruno collection in `bruno/` ("Trying the API" in [api.md](api.md)).

## A mid-sized company

`bun run db:seed --company` also adds Lumen Works (`src/db/seed-company.ts`), for checking
queries and pages at a realistic size: 18 members in four teams, one former member, and
about 20,000 entries over the year before the seed ran. The year has weekends, holidays,
vacations, part-time and late-joining members, projects archived partway through, evening
and overnight work, descriptions with ticket keys such as `NBW-412`, and three running
timers. Run it on a database seeded without it to
add the company. It takes under a second.

The sign-in page also lists five of its users, with the same password:

| Email                         | Name           | Role                                                                    |
| ----------------------------- | -------------- | ----------------------------------------------------------------------- |
| `kristiina@lumen.example.com` | Kristiina Kask | Owner, in no team                                                       |
| `jonas@lumen.example.com`     | Jonas Berg     | Admin, in Web                                                           |
| `sofia@lumen.example.com`     | Sofia Rossi    | Lead of Web                                                             |
| `daniel@lumen.example.com`    | Daniel Park    | Lead of Mobile, in New York, weeks start on Sunday; has a running timer |
| `marta@lumen.example.com`     | Marta Nowak    | Member in Design and Web, works three days a week                       |

## Scripts

| Command                       | What it does                                                 |
| ----------------------------- | ------------------------------------------------------------ |
| `bun --bun run dev`           | Starts the dev server on port 3100                           |
| `bun run build`               | Builds for production                                        |
| `bun run build:self-hosted`   | Builds for a self-hosted server, with precompressed files    |
| `bun run build:binary`        | Compiles self-hosted Linux releases for x64 and Arm64        |
| `bun run test`                | Runs server tests (`bun test`) and component tests           |
| `bun run test:conformance`    | Builds the app and tests its JSON API (`conformance/`)       |
| `bun run lint`                | Runs oxlint                                                  |
| `bun run format`              | Formats with oxfmt                                           |
| `bun run env:init`            | Adds a `BETTER_AUTH_SECRET` to `.env.local`                  |
| `bun run db:generate <name>`  | Creates an empty SQL migration                               |
| `bun run db:migrate`          | Verifies and applies migrations                              |
| `bun run db:drift`            | Compares the Drizzle schema with the migrations              |
| `bun run db:seed [--company]` | Seeds the local database with demo data                      |
| `bun run holidays:update`     | Refreshes the saved public holidays                          |
| `bun run perf`                | Checks bundle budgets, query plans, and report sizes         |
| `bun run perf:pages`          | Measures pages in Chrome (see `perf/README.md` for the rest) |
| `bun run datamodel`           | Opens the data model in ChartDB (needs Docker)               |

## Database

`bun run db:import` interactively copies cloud data into a fresh local database,
optionally selecting one company and clearing authentication state. Run it with
the destination app offline. See the [Compose import guide](deployment/compose.md#import-an-existing-cloud-company)
for environment variables, company filtering, and the deployment procedure.

`bun run start:self-hosted` runs the standalone production build. With
`MIGRATE_ON_START=true`, it verifies and applies local migrations before listening.
The Docker Compose deployment enables this option.

The SQL migrations in `drizzle/` define the schema; they are written by hand, and
`src/db/schema.ts` follows them. Read [migrations.md](migrations.md) before
changing the schema. The data model, its diagram, and how to view it are in
[datamodel/README.md](../datamodel/README.md).
