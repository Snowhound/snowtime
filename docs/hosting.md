# Hosting

Goal: run initially on the Vercel and Turso free tiers.

## Vercel (Hobby)

- Hosts the TanStack Start app as Vercel Functions plus static assets.
- Hobby is limited to personal, **non-commercial** use per Vercel's terms.
  Company use by Snowhound and hosting other companies are likely commercial
  and may require the Pro plan. Confirm before relying on Hobby in production.
- Functions run in a single region; pick it to match the Turso `prod` database.

## Turso (Free)

- Hosts the `staging` and `prod` databases.
- Free-tier quotas (storage, rows read/written per month) are the main scaling
  limit. Avoid query patterns that scan large ranges repeatedly; the running
  timer is never written periodically (see `architecture.md`).

## Implications for design

- No background workers or cron beyond what the free tiers allow; compute on
  request.
- One database per environment shared by all tenants (row-level isolation),
  keeping the database count small.
- Check current quotas on the vendors' pricing pages rather than hardcoding
  them here.
