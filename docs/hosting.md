# Hosting

Goal: run initially on the Vercel and Turso free tiers. The alternative is one self-hosted
Linux server. Setup steps for both are in `deployment/README.md`.

## Vercel (Hobby)

- Hosts the TanStack Start app as Vercel Functions plus static assets.
- Hobby is limited to personal, **non-commercial** use per Vercel's terms.
  Company use by Snowhound and hosting other companies are likely commercial
  and may require the Pro plan. Confirm before relying on Hobby in production.
- Functions run in a single region; pick it to match the Turso `prod` database.
- A function's response is at most 4.5 MB. The largest is the report export's entry list
  (`architecture/reports.md`, "Report export"), which the browser fetches a calendar month at a
  time. On 2026-09-29 the owner's year on the Lumen Works seed (19 people, 20,300 entries) came in
  13 pieces of at most 755 KB as sent, 8.1 MB in all; in one response it had been 7.8 MB.
- Each function instance has its own memory, so in-memory state doesn't hold across
  requests. Rate-limit counts stay per instance unless Upstash Redis holds them. Snowhound's
  deployment runs without Upstash for now (`architecture/auth.md`, "Abuse limits").

## Turso (Free)

- Hosts the `prod` database and `snowtime-staging`, the seeded database every preview
  deployment shares (`architecture/auth.md`, "Preview deployments").
- Free-tier quotas (storage, rows read/written per month) are the main scaling
  limit. Avoid query patterns that scan large ranges repeatedly; the running
  timer is never written periodically (see `architecture/data.md`).

## Upstash Redis (Free)

- Holds the rate-limit counts, one Redis command per counted request. Optional: without
  it the app runs, but the limits apply per function instance.
- Use one database per environment, so staging traffic doesn't count against `prod`.
  The free plan allows one database, so previews count in memory.

## Self-hosted (one Linux server)

Any Linux server with systemd works: a VPS, a dedicated server, or a machine on premises.
Hetzner Cloud is the example in `deployment/self-hosted.md`, which also lists the
requirements in full.

[Docker Compose](deployment/compose.md) is an alternative to systemd for the app and
Caddy. Cloudflare's proxy is a suggested CDN for static assets: cache the public files,
and bypass HTML, authentication, and the JSON API. The initial Compose demo defers
Litestream backups.

- Exactly one app process per database. Two processes writing one SQLite file bring back
  the lost writes of task 043, so there is no second instance, cluster mode, or
  zero-downtime handover. A restart pauses requests for about a second; Caddy holds them.
- Within the app process, statements queue while a transaction is open
  (`src/db/connection.ts`), so two requests never meet each other's lock. Another process
  that holds the write lock for more than 5 seconds still makes the app's write fail with
  `SQLITE_BUSY` and can lose that connection's later writes (task 043), so stop the app
  for a migration that rewrites a large table. Snowhound's production stays on Vercel and
  Turso; the internal demo runs on Hetzner.
- Scaling is vertical only. One process renders on one core: in `perf:load` on 2026-09-30,
  ordinary pages took 15–50 ms of CPU and the 9-month report 85–92 ms, so a shared vCPU
  serves roughly 20–40 ordinary pages a second.
- Memory peaked near 400 MB under load. The minimum is 1 vCPU and 2 GB; 2 vCPU and 4 GB
  (Hetzner CX23 or CAX11) leave a core for Caddy, Litestream, and the OS.
- The database grows by about 640 bytes per time entry, indexes included; 1,000 people
  add about 1 GB a year.
- Rate-limit counts live in the process's memory, which is correct with one process;
  Upstash isn't needed. A restart resets them.
- Backups are Litestream's: each change reaches the bucket within a second, with a daily
  snapshot kept for a week. The bucket belongs in another location or with another
  provider than the server.
- The operator patches the OS and keeps Caddy, Litestream, and Cloudflare's address list
  in the Caddyfile current.
- The server is in one location, so users far from it wait longer on every page.

## Implications for design

- No background workers or cron beyond what the free tiers allow; compute on
  request. Self-hosting could run them, but the app must keep working on Vercel.
- One database per environment shared by all tenants (row-level isolation),
  keeping the database count small.
- Check current quotas on the vendors' pricing pages rather than hardcoding
  them here.
