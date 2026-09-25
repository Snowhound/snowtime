# Hosting

Goal: run initially on the Vercel and Turso free tiers.

## Vercel (Hobby)

- Hosts the TanStack Start app as Vercel Functions plus static assets.
- Hobby is limited to personal, **non-commercial** use per Vercel's terms.
  Company use by Snowhound and hosting other companies are likely commercial
  and may require the Pro plan. Confirm before relying on Hobby in production.
- Functions run in a single region; pick it to match the Turso `prod` database.
- Each function instance has its own memory, so in-memory state doesn't hold across
  requests. Rate-limit counts therefore need Upstash Redis on Vercel: set
  `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, with the Upstash database in
  the functions' region (`architecture.md`, "Abuse limits").

## Turso (Free)

- Hosts the `staging` and `prod` databases.
- Free-tier quotas (storage, rows read/written per month) are the main scaling
  limit. Avoid query patterns that scan large ranges repeatedly; the running
  timer is never written periodically (see `architecture.md`).

## Upstash Redis (Free)

- Holds the rate-limit counts, one Redis command per counted request. Optional: without
  it the app runs, but the limits apply per function instance.
- Use one database per environment, so staging traffic doesn't count against `prod`.

## Implications for design

- No background workers or cron beyond what the free tiers allow; compute on
  request.
- One database per environment shared by all tenants (row-level isolation),
  keeping the database count small.
- Check current quotas on the vendors' pricing pages rather than hardcoding
  them here.
