# 087: Preview deployments on a staging database

Status: in-progress

Vercel preview deployments had no database and no way to sign in. They now run in demo mode
against `snowtime-staging`, a seeded Turso database in the `stockholm` group, so a branch can
be tried with the seeded users before it merges.

## Acceptance criteria

- [x] `DEMO_MODE=true` is allowed with a remote database only when `VERCEL_ENV=preview`.
- [x] On a preview, the app's URL is `https://$VERCEL_BRANCH_URL`, `$VERCEL_URL` is a
      trusted origin, and `BETTER_AUTH_URL` is refused.
- [x] The **Migrate staging** workflow migrates staging on each branch push that changes
      `drizzle/`, and on demand.
- [x] `docs/deployment/vercel.md`, `docs/architecture/auth.md`, `docs/hosting.md`,
      `docs/migrations.md`, and `docs/architecture/platform.md` describe previews on
      staging.
- [ ] The Vercel Preview variables and the GitHub `staging` environment are set.
- [ ] On a preview, `owner@example.com` signs in, starts a timer, and stops it.
