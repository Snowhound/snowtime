<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/brand-assets/lockups/02-hound-hour-dark.svg" />
    <img src="design/brand-assets/lockups/02-hound-hour.svg" alt="Snowtime" height="80" />
  </picture>
</h1>

<p align="center">
  A minimal, multi-tenant time tracker in the spirit of Toggl.<br />
  <a href="https://snowtime.snowhound.eu"><strong>snowtime.snowhound.eu</strong></a>
</p>

<p align="center">
  <img src="docs/images/timer-dark-winter.webp" alt="The timer view in the dark theme over the winter scene: a running timer, yesterday's entries, and the week's summary by project" width="760" />
</p>

Snowhound built Snowtime for its own teams, and it can host other organizations from the
same deployment.

## Features

- One-click timer with a description, project, and ticket key, in a bar or a focus
  layout with chips to continue recent work
- Entries in a list by day or in a week calendar, where a drag on empty time adds an entry
  and dragging an entry moves it or changes its times
- Ticket keys such as `NBW-412` in descriptions, optionally linked to the organization's
  issue tracker
- Organizations, teams, members, and invitations, with owner, admin, member, and team
  lead roles
- Projects per organization, optionally assigned to teams
- Reports per day, week, project, team, member, and ticket in the user's time zone: a
  summary, a breakdown, a timesheet, and the entries, with CSV and XLSX export
- Public holidays per country, which don't count as missing hours
- Light and dark themes over a seasonal scene with weather, which each user can change or
  turn off
- Sign-in with Google, GitHub, Microsoft, or a passkey
- English and Estonian

The scope and what is left out on purpose are in [docs/product.md](docs/product.md).

## Stack

[TanStack Start](https://tanstack.com/start) with [Solid](https://www.solidjs.com),
[Turso](https://turso.tech) (libSQL) through [Drizzle](https://orm.drizzle.team),
[Better Auth](https://www.better-auth.com), [Solid-UI](https://www.solid-ui.com) with
Tailwind CSS, and [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs),
built with Nitro and Bun. Each choice and its reason is recorded in
[docs/architecture/](docs/architecture/README.md).

## Where it runs

Snowtime supports two deployment targets, from the same code and configured only through
environment variables. Either can host many organizations, or a dedicated stack per
client.

- **Vercel and Turso:** Vercel Functions with a Turso database in the same region, and
  optionally Upstash Redis. Free tiers are enough to start, but Vercel Hobby is for
  non-commercial use only.
- **Self-hosted:** one Linux server with systemd, running the app with SQLite in its
  process, Caddy in front (optionally behind Cloudflare's proxy), and Litestream backups
  to an S3-compatible bucket. The estimated size is 2 vCPU and 4 GB of memory, for example
  Hetzner's smallest such plan.

[docs/deployment/](docs/deployment/README.md) compares the two and has a step-by-step
runbook for each, and [docs/hosting.md](docs/hosting.md) lists each platform's limits. The
self-hosted size is an estimate from a local benchmark; it hasn't been checked on a real
server yet.

The app builds with Nitro, so other hosts Nitro supports, such as Cloudflare Workers,
Netlify, or a container platform, could be added. They aren't supported or tested yet;
[docs/deployment/](docs/deployment/README.md#other-targets) lists what each would need.

Snowhound's own deployment runs on Vercel with a Turso database per environment: `prod`
for `main`, and a planned `staging` for `develop`. After the checks pass on a push to
`main`, CI migrates `prod` and deploys it.

## Tested data size

The performance checks run on the Lumen Works seed (`bun run db:seed --company`): 19
people in four teams with about 20,000 entries over a year. On it, a self-hosted server
limited to 2 CPUs renders ordinary pages in under 40 ms and a report on nine months of the
whole company in under 100 ms, and the database stays under 20 MB. Larger organizations
haven't been measured. The harnesses are in [perf/README.md](perf/README.md).

## Local development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run env:init
bun run db:migrate
bun run db:seed
bun --bun run dev
```

The app runs on http://localhost:3100 against a local SQLite file, and every seeded user
signs in with the password `snowtime-local`. The seeded users, the larger company seed,
the scripts, and the database workflow are in [docs/development.md](docs/development.md).

## Documentation

- [Product](docs/product.md): purpose, MVP scope, and tenancy
- [Architecture](docs/architecture/README.md): recorded decisions and their reasons
- [Hosting](docs/hosting.md): Vercel, Turso, and self-hosted constraints
- [Development](docs/development.md): local setup, seeded users, scripts, and the database
- [Deployment](docs/deployment/README.md): runbooks for Vercel and for self-hosting
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
