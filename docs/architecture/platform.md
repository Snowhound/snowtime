# Platform

## Supported browsers

Snowtime supports the latest two major versions of Chrome, Edge, Firefox, and Safari, desktop
and mobile (task 058). Those are the browsers it's tested in and fixed for. An older browser
that has what the app uses gets no notice, because a few versions back in all likelihood still
works; one that lacks it gets a notice at the top of each page.

- Build: Vite's `build.target` stays its default, Baseline Widely Available (Chrome and Edge
  111, Firefox 114, Safari 16.4 in Vite 8), so the output's syntax doesn't lock out browsers
  older than the supported window that could run the app. Tailwind 4 needs about the same:
  Chrome 111, Safari 16.4, and Firefox 128 (the current ESR) for `@property`.
- APIs: `tsconfig.json`'s `lib` may allow more than the build target has, now ES2023. Any
  feature the app uses beyond the build target goes in the check's list
  (`src/lib/browser-check.ts`), so a browser without it sees the notice rather than a broken
  page.
- Check: an ES5 script in `<head>`, apart from the theme script, which an old browser can't
  parse. It tests features (`toSorted`, `CSS.registerProperty`, `:has()`, `color-mix()`),
  not user agents, which lie and go stale. A test parses it as ES5. It costs well under a
  millisecond per page and carries the CSP nonce like the theme script.
- Notice (`src/components/browser-notice.tsx`): the server renders it hidden, in the page's
  language, and the check shows it, so it needs none of the app's scripts. It names the
  supported browsers, doesn't block the page, and a dismissal lasts the session
  (`snowtime.browserNoticeDismissed` in `sessionStorage`). Its styles are inline, because a
  browser that drops the stylesheet's cascade layers loses every Tailwind class.

## Deployment model

- Default: one shared multi-tenant deployment.
- Must remain possible: a dedicated stack per client (own Vercel project and
  Turso database, or own server) from the same codebase, with no code changes.
- Therefore: nothing tenant-specific in code (no hardcoded org names,
  domains, or branding); everything instance-specific comes from env vars;
  migrations apply cleanly to an empty database.

## Environments and deployment

| Environment | Branch    | Database                                                   |
| ----------- | --------- | ---------------------------------------------------------- |
| Local       |           | `file:local.db`, no token                                  |
| Preview     | any other | `snowtime-staging` Turso database, seeded and shared       |
| Production  | `main`    | `prod` Turso database, same region as the Vercel functions |

Production runs in Vercel's `dub1` (Dublin) with Turso's `aws-eu-west-1` (Ireland), the
only EU region Turso offers. A page makes several database round trips, so the functions
sit beside the database rather than nearer to users in Estonia. Postgres nearer to
Estonia was rejected for now: Supabase in Stockholm (with Vercel `arn1`) or Neon in
Frankfurt (`fra1`) would save roughly 20–30 ms per request, but both mean porting the
schema, migrations, and tooling from SQLite, and the free tiers pause idle databases. If
this changes, switch before production holds real data.

**Migrations and deploys:** CI runs `db:migrate` after the checks pass on a push to the
environment's branch, and then deploys that commit to Vercel. Migrations never run in the
Vercel build or on Vercel app start. Production only
receives merged migrations, because `db:verify` rejects an applied migration that a PR
later edits, and two open PRs would mix their migrations in one shared database. PRs
test their migrations on throwaway local databases (`db:drift`). The staging database is
the exception: a push that changes a branch's migrations applies them there, and staging
is reseeded when branches' migrations conflict (`../migrations.md`, "Staging"). It holds
only seeded data, so a reseed costs nothing.

- Preview deployments of every branch run in demo mode against the seeded staging
  database and sign in with the seeded users (task 087; `auth.md`, "Preview
  deployments"). A `develop` branch on a fixed staging host was planned before and
  dropped: only that branch could sign in.
- Vercel doesn't deploy `main` by itself (`vercel.json`). CI's `deploy-prod` job runs
  `vercel deploy --prod` once the migration has applied, so a failed check or migration
  keeps new code off production. Vercel used to deploy each push in parallel with CI;
  on 2026-09-27 a failed knip check skipped a migration, the new code read a column prod
  didn't have, and every signed-in page failed. Vercel's Deployment Checks, which hold a
  deployment until chosen GitHub checks pass, were rejected: the setting lives in each
  project's dashboard, not the repository, so every client stack would need it by hand.
  The previous deployment serves until the new one is ready, so migrations stay backward
  compatible.
- Self-hosted (task 075), one server runs one app process with the database as a local
  file, because going through `sqld` over HTTP made pages 2–3 times slower and used 3–4
  times the CPU. The app can't be split from the database across providers either: each
  of a page's round trips would cost 10–30 ms. A deploy is manual: copy a release,
  migrate the file with `db:migrate` or the release's `snowtime-migrate`, then restart.
  Litestream streams the file to S3-compatible storage. Turso Sync was evaluated as the
  backup instead and not adopted, because it swaps libSQL for Turso's pre-1.0 engine.
- Docker Compose is supported for the standalone app and Caddy, with exactly one app
  process and a persistent SQLite volume. Both images contain the same release's code
  and static files. Compose enables migration inside the standalone process before
  it starts listening, so live writes cannot conflict with migrations. Explicit migration
  and seed containers run while the app is stopped. Other standalone deployments can
  opt in with `MIGRATE_ON_START=true`; Vercel retains its CI migration flow.
  The initial Hetzner demo at `snowtime-internal.snowhound.eu` defers backups and uses
  Cloudflare as a CDN for static files. HTML and server responses bypass caching.
  Its images are built on GitHub Actions and pushed to GHCR, and it deploys only when
  someone runs the manual Compose deploy workflow, never on a push.
  Setup is in [the Compose runbook](../deployment/compose.md).
- Both deployments use `@libsql/client` (task 077, decided 2026-09-30). Turso's own
  drivers were measured and not adopted:
  - `@tursodatabase/serverless` through Drizzle (`drizzle-orm/tursodatabase-serverless`)
    sends a `describe` request before most queries, queues every query of an instance
    behind one connection, lets other requests' statements run inside an open
    transaction, and fails the first query after about 10 idle seconds with "The stream
    has expired due to inactivity". Against `sqld` with 20 ms of added latency, a month
    report took 204 ms against libSQL's 66 ms, and 10 parallel requests 444 ms against
    37 ms.
  - `@tursodatabase/database` 0.8.1 ran year reports about 40% faster than libSQL on the
    benchmark database and keeps a connection's writes after `SQLITE_BUSY`. It doesn't
    share a file with SQLite in another process, even with its experimental
    `multiprocess_wal` on Linux: a libSQL write while it was open erased its committed
    rows, and SQLite reads failed with `SQLITE_BUSY`, then "file is not a database" once
    it closed. `db:migrate`, `db:seed`, the `sqlite3` shell, and Litestream all open
    the file from another process. Look again once the engine interoperates.
  - `@libsql/client/web` for remote URLs, which skips the native addon, saved about 11 ms
    of import time in Node. Nitro puts both of the package's entries in one chunk, so the
    addon loaded anyway; the gain isn't worth a build-time alias.
- Planned: CI also applies `main`'s migrations to a throwaway database, seeds it, and
  then applies the PR's migrations, to catch a migration that fails on existing rows
  (for example a `NOT NULL` column without a default).

## Internationalization

- Languages: English (`en`, default) and Estonian (`et`). The UI translates with
  Paraglide JS: messages in `messages/<locale>.json`, options in
  `project.inlang/paraglide.config.ts`, compiled to `src/paraglide/` (generated, not
  committed) by the Vite plugin and by `bun run i18n:compile`, which `postinstall` and
  `bun run test` run.
- The locale lives in the `PARAGLIDE_LOCALE` cookie, not the URL: the app has no public pages
  that need localized links. Without the cookie, the browser's `Accept-Language` picks it,
  then English. Signed-in pages set the cookie from `user_settings.locale`: when the account's
  language differs from the request's, `getAppSession` sets the cookie and the page loads
  again, so the user sees only the account's language. The cookie never holds anything but the
  account's language (see "Cookies and consent" in [auth.md](auth.md)). `src/server-entry.ts`
  runs Paraglide's middleware around every request, which scopes the locale per request.
- The user's language is `user_settings.locale` (see "User settings" in [timer.md](timer.md)).
  The first `getSettings` call sets it from the browser, as it does the time zone.
- The server returns keys, dates, and numbers, never display text; the client translates
  and formats them in the user's locale and zone.
  - Each `AppError` carries a stable snake_case message key from the catalog in
    `src/server/errors.ts`. The catalog's English text is the error message, for logs and
    as the client's fallback; `errorMessage` in `src/lib/errors.ts` looks the key up as
    the Paraglide message `error_<key>`.
  - Better Auth's client calls return an error with a code instead, such as
    `YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`. `errorMessage` maps the codes
    the Organization view can meet to Paraglide messages; any other code gets the generic
    message.
  - Valibot issues need no server translation: forms run the same schemas in the browser
    first, so only a faulty or hostile client reaches the server's validation. Custom
    messages in the `*.schemas.ts` files are Paraglide calls, evaluated when validation runs.

## Error and not-found pages

- `ErrorPage` and `NotFoundPage` (`src/features/errors/`) are the router's
  `defaultErrorComponent` and `defaultNotFoundComponent` (`src/router.tsx`). Every route
  gets them, not only the root route, because on the server TanStack's Solid router renders
  a failed route's error with that route's own component, not a parent's.
- Under the signed-in layout, the page shows inside the app frame. Elsewhere, such as an
  unknown path or a failed layout, it picks the frame from the session: the app frame for
  a member of an organization, otherwise the auth layout. The root route's shell renders
  its match as children, so the root's boundaries catch errors in `beforeLoad`.
- The error page shows `errorMessage` of the error (see "Internationalization"): an
  `AppError`'s message, or the generic one for anything else. It offers a retry, which
  reloads the routes, and a link home.
- While the database is unreachable, for example while production moves to another
  database, the error page is a maintenance page instead. `availabilityMiddleware`
  (`src/server/middleware.ts`) runs around every server function. When one fails with an
  unexpected error, the middleware runs `select 1`, and if that fails or takes over 3
  seconds, it throws an `UNAVAILABLE` `AppError`. The maintenance page stays at the
  requested URL, so a reload opens that page once the database is back. It calls
  `checkAvailability` every 15 seconds while the tab is visible, and again on focus,
  when the tab is shown, or when the device comes online. Once the database answers,
  it reloads the routes. A failed change shows the same error's message. Better Auth's
  own routes, such as sign-in, still fail with their generic error.
- An unknown path answers 404. A route whose loader reads one record named in the URL
  throws `notFound()` when the record is missing, so the reader gets the not-found page
  and a 404 rather than an error. No route does so yet: the invitation page shows a missing
  invitation as closed.
- For a loader's error, the router renders the error component in place of the route on
  the server but as the error boundary's fallback on the client, so hydration would add a
  second page. `ErrorPage` therefore throws again during the server's first render, which
  has no `reset`, so that Solid's boundary renders it on both sides. Solid sends that error
  to the client before Start's serialization adapters load, so it is a plain `Error`
  carrying only the message to show and whether the database was unreachable. Remove the workaround once the router renders both
  sides alike.
- The router's dehydrated state still carries a loader error's own message in the page
  source, though the page never shows it. Start already sends a server function's error
  message to the browser, so this adds no new exposure.

## Performance harnesses

`perf/` holds three harnesses (task 069); `perf/README.md` says what each measures and how
to update a baseline on purpose:

- `bun run perf`: bundle budgets, query plans, and report rows and bytes, with no browser.
  CI runs it.
- `bun run perf:pages`: page bytes, DOM nodes, hydration, and interaction delay in Chrome.
- `bun run perf:weather`: the weather's GPU and compositor cost under the glass, and golden
  frames of every preset.

They gate only counts that don't depend on the machine (bytes, rows, plans, nodes, pixels)
and print timings, since no machine here gives stable ones. Data comes from the company
seed at a fixed date, with the server's and browser's clocks moved to it.
