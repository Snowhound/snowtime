# Deploy on Vercel and Turso

This runbook sets up one production stack from scratch: a Turso database, optional
Upstash Redis, a Vercel project, one or more OAuth apps, and the GitHub environment CI
migrates and deploys from. Follow it for your own deployment or for a dedicated stack per
client. [The deployment index](README.md) compares it with self-hosting and holds the steps
both share. The reasons behind the choices are in `../architecture/platform.md` ("Environments and
deployment"), and the free-tier limits are in `../hosting.md`.

Preview deployments of other branches run against a shared staging database; step 8 sets
them up.

## Before you start

- Accounts: Vercel, Turso, GitHub (the repository or your fork), and optionally Upstash.
  Vercel's Hobby plan is for non-commercial use only (`../hosting.md`).
- Pick one region for everything. The functions must run beside the database, because a
  page makes several database round trips. Snowhound uses Turso `aws-eu-north-1` with
  Vercel `arn1`, both in Stockholm. Run `turso db locations` to see which Turso region is
  closest to your users, and pick the Vercel region in the same AWS region (the [Vercel region list](https://vercel.com/docs/regions) names each
  one's AWS region).

## 1. Create the Turso database

```bash
brew install tursodatabase/tap/turso   # or see docs.turso.tech for other platforms
turso auth signup                      # or: turso auth login
turso db create <app>-prod --location aws-eu-north-1
turso db show <app>-prod --url         # TURSO_DATABASE_URL
turso db tokens create <app>-prod      # TURSO_AUTH_TOKEN
```

Keep the URL and token for steps 5 and 6. Anyone with the token can read and write the
database, so store it only as a secret.

## 2. Create the Upstash Redis database (optional)

Upstash holds the rate-limit counts, so every Vercel function instance sees the same
counts. Without it the app runs, but each instance limits on its own
(`../architecture/auth.md`, "Abuse limits").

1. In the [Upstash console](https://console.upstash.com), create a Redis database with
   its primary region nearest the functions and no read replicas. Upstash has no
   Stockholm region; for `arn1`, Frankfurt is nearest.
2. Copy the REST URL and REST token: `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`.

Create the database in the Upstash console rather than through the Vercel Marketplace.
The Marketplace integration sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which the app
doesn't read.

## 3. Create the Vercel project and find its host

1. Import the repository into Vercel. `vercel.json` selects the TanStack Start
   framework, so leave the build settings at their defaults. `vercel.json` also stops
   Vercel from deploying `main` by itself; CI deploys it from step 5 on. Until step 6
   sets the environment variables, a production deployment fails or shows an error page.
2. Under **Settings > Functions**, set the function region to the one from
   [Before you start](#before-you-start), for example `arn1`. Vercel's default is
   `iad1` (Washington, D.C.).
3. Under **Settings > Domains**, note the production host. Vercel generates
   `<project>.vercel.app`, with a suffix if that name is taken. To use your own domain
   instead, add it here and create the DNS record Vercel shows, usually a CNAME. On
   Cloudflare, set the record to **DNS only**: its proxy can block the certificate, and
   Vercel would see Cloudflare's addresses instead of the users', which merges everyone
   into a few per-IP rate limits.

The next steps write this host as `<host>`. OAuth callbacks and passkeys are bound to it
through `BETTER_AUTH_URL`; to change it later, see
[Changing the host later](README.md#changing-the-host-later).

## 4. Register the OAuth apps

Register at least one provider for `<host>`, as
[Register the OAuth apps](README.md#register-the-oauth-apps) describes.

## 5. Let CI migrate and deploy

After the checks pass on a push to `main`, the `migrate-prod` job in
`.github/workflows/ci.yml` runs `bun run db:migrate` against the production database.
The `deploy-prod` job then runs `vercel deploy --prod`, and Vercel builds the commit with
the project's environment variables. Preview deployments of other branches still come
from Vercel's Git integration. Until a job's secrets are set, it skips and leaves a notice
in the run summary. A skipped migration skips the deploy too, so unmigrated code never
goes live.

1. Create a Vercel token under **Account Settings > Tokens**
   ([vercel.com/account/settings/tokens](https://vercel.com/account/settings/tokens)).
   Scope it to the team or account that owns the project. This is `VERCEL_TOKEN`. When
   it expires, `deploy-prod` fails until you replace the secret, so note the date.
2. Find the project's IDs with the Vercel CLI. In the repository, run `vercel link` and
   pick the project. The gitignored `.vercel/` folder then holds them: in `repo.json`,
   the project's `orgId` (`VERCEL_ORG_ID`) and `id` (`VERCEL_PROJECT_ID`); with older
   CLIs, `project.json` with `orgId` and `projectId`. The dashboard shows them too:
   the project ID under the project's **Settings > General**, and the team ID under the
   team's **Settings > General**.
3. In the GitHub repository, open **Settings > Environments** and create `production`
   (the first CI run on `main` may already have created it).
4. Add the secrets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from step 1, and
   `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`. Repository secrets
   (**Settings > Secrets and variables > Actions**) also work, because a job reads them
   as well as its environment's. Environment secrets add a branch rule: under
   **Deployment branches and tags**, allow only `main`.
5. Re-run the latest workflow on `main`, or push to it. The `migrate-prod` job applies
   every migration to the empty database, and `deploy-prod` deploys.

To migrate or deploy from your machine instead, for example before CI is set up in a
fork, migrate first:

```bash
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... bun run db:migrate
vercel deploy --prod
```

The previous deployment serves until the new one is ready, so it runs against the
migrated database for a few minutes. Keep migrations backward compatible
(`../migrations.md`).

## 6. Set the environment variables and redeploy

1. Generate the auth secret, as
   [Set the environment variables](README.md#set-the-environment-variables) shows.
2. In the Vercel project, under **Settings > Environment Variables**, add these for the
   Production environment and mark the secrets sensitive:

   | Variable                                             | Value                                 |
   | ---------------------------------------------------- | ------------------------------------- |
   | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`             | Step 1                                |
   | `BETTER_AUTH_SECRET`                                 | Above                                 |
   | `BETTER_AUTH_URL`                                    | `https://<host>`, no trailing slash   |
   | `<PROVIDER>_CLIENT_ID`, `<PROVIDER>_CLIENT_SECRET`   | Step 4, both or neither per provider  |
   | `MICROSOFT_TENANT_ID`                                | Optional, restricts Microsoft sign-in |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Step 2, both or neither               |

   Leave `CLIENT_IP_HEADER` unset: Vercel puts the user's address in `x-forwarded-for`,
   which Better Auth reads by default.

3. Leave `BETTER_AUTH_URL` and `DEMO_MODE` unset for Preview: a preview takes its URL from
   Vercel, and step 8 adds its variables.
4. Redeploy the latest production deployment in Vercel, or re-run the latest workflow on
   `main`, so it runs with the region and variables. Vercel applies both only to
   deployments made after the change.

## 7. Check the deployment

Everything in [Check the deployment](README.md#check-the-deployment) applies, plus:

- With Upstash configured, keys starting with `rate-limit:` appear in its data browser
  after a few writes.
- If a page fails, the function logs under the deployment in Vercel show the error,
  including the missing variable when `src/env.ts` rejects the configuration.

## 8. Set up preview deployments on a staging database (optional)

Previews have generated hosts, where OAuth can't work, so they run in demo mode against a
seeded staging database and sign in with the seeded users (`../architecture/auth.md`,
"Preview deployments"). The seed password is public, so keep staging free of real data.

1. Seed a local file and create the staging database from it. `db:seed` refuses remote
   databases, so this is also how to reset staging later:

   ```bash
   rm -f /tmp/staging.db
   TURSO_DATABASE_URL=file:/tmp/staging.db bun run db:migrate
   TURSO_DATABASE_URL=file:/tmp/staging.db bun run db:seed --company
   turso db create <app>-staging --location <region> --from-file /tmp/staging.db
   turso db show <app>-staging --url        # TURSO_DATABASE_URL
   turso db tokens create <app>-staging     # TURSO_AUTH_TOKEN
   ```

   To reset, run `turso db destroy <app>-staging` before `turso db create`, and replace
   the token in Vercel and GitHub.

2. In the Vercel project, under **Settings > Environment Variables**, add these for the
   Preview environment only, and mark the secrets sensitive:

   | Variable                                 | Value                          |
   | ---------------------------------------- | ------------------------------ |
   | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | The staging database           |
   | `BETTER_AUTH_SECRET`                     | A new secret, not production's |
   | `DEMO_MODE`                              | `true`                         |

   Upstash is optional, as its own database as in step 2, so previews don't share
   production's counts; without it they count in memory. Leave `BETTER_AUTH_URL`, the OAuth variables, and
   `ALLOWED_LOGIN_DOMAINS` unset. `src/env.ts` refuses `BETTER_AUTH_URL` and `ALLOWED_LOGIN_DOMAINS` on a
   preview. Under **Settings > Environment Variables**, keep **Automatically expose
   System Environment Variables** on: the app reads `VERCEL_ENV`, `VERCEL_BRANCH_URL`, and
   `VERCEL_URL`.

3. Under **Settings > Deployment Protection**, keep Vercel Authentication on for
   previews.
4. In GitHub, under **Settings > Secrets and variables > Actions**, add the repository
   secrets `STAGING_TURSO_DATABASE_URL` and `STAGING_TURSO_AUTH_TOKEN` for the
   **Migrate staging** workflow (`../migrations.md`, "Staging"). The prefix keeps them
   apart from production's `TURSO_` secrets, which may also be repository secrets.
5. Push a branch, open its preview, and sign in as `owner@example.com`.
