# Deployment

This runbook sets up one production stack from scratch: a Turso database, optional
Upstash Redis, a Vercel project, one or more OAuth apps, and the GitHub environment CI
migrates from. Follow it for your own deployment or for a dedicated stack per client. The
reasons behind the choices are in `architecture.md` ("Environments and deployment"), and
the free-tier limits are in `hosting.md`.

Staging (the `develop` branch) is planned and not covered here.

## Before you start

- Accounts: Vercel, Turso, GitHub (the repository or your fork), and optionally Upstash.
  Vercel's Hobby plan is for non-commercial use only (`hosting.md`).
- Pick one region for everything. The functions must run beside the database, because a
  page makes several database round trips. For users in Europe, use Turso
  `aws-eu-west-1` (Ireland) with Vercel `dub1` (Dublin). Run `turso db locations` to see
  whether Turso offers a region closer to your users, and pick the Vercel region in the
  same AWS region (the [Vercel region list](https://vercel.com/docs/regions) names each
  one's AWS region).

## 1. Create the Turso database

```bash
brew install tursodatabase/tap/turso   # or see docs.turso.tech for other platforms
turso auth signup                      # or: turso auth login
turso db create <app>-prod --location aws-eu-west-1
turso db show <app>-prod --url         # TURSO_DATABASE_URL
turso db tokens create <app>-prod      # TURSO_AUTH_TOKEN
```

Keep the URL and token for steps 5 and 6. Anyone with the token can read and write the
database, so store it only as a secret.

## 2. Create the Upstash Redis database (optional)

Upstash holds the rate-limit counts, so every Vercel function instance sees the same
counts. Without it the app runs, but each instance limits on its own
(`architecture.md`, "Abuse limits").

1. In the [Upstash console](https://console.upstash.com), create a Redis database with
   its primary region in the functions' AWS region (`eu-west-1` for Dublin) and no read
   replicas.
2. Copy the REST URL and REST token: `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`.

Create the database in the Upstash console rather than through the Vercel Marketplace.
The Marketplace integration sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which the app
doesn't read.

## 3. Create the Vercel project and find its host

1. Import the repository into Vercel. `vercel.json` selects the TanStack Start
   framework, so leave the build settings at their defaults. The first deployment
   fails or shows an error page until step 6 sets the environment variables.
2. Under **Settings > Functions**, set the function region to the one from
   [Before you start](#before-you-start), for example `dub1`. Vercel's default is
   `iad1` (Washington, D.C.).
3. Under **Settings > Domains**, note the production host. Vercel generates
   `<project>.vercel.app`, with a suffix if that name is taken. To use your own domain
   instead, add it here and create the DNS record Vercel shows, usually a CNAME. On
   Cloudflare, set the record to **DNS only**: its proxy can block the certificate, and
   Vercel would see Cloudflare's addresses instead of the users', which merges everyone
   into a few per-IP rate limits.

The next steps write this host as `<host>`. OAuth callbacks and passkeys are bound to it
through `BETTER_AUTH_URL`; to change it later, see
[Changing the host later](#changing-the-host-later).

## 4. Register the OAuth apps

Production has no password sign-in, and a passkey can only be added to an existing
account, so at least one OAuth provider must be configured or nobody can sign in. Each
provider redirects to `https://<host>/api/auth/callback/<id>`.

| Provider  | Where                                                 | Redirect URL                                 |
| --------- | ----------------------------------------------------- | -------------------------------------------- |
| GitHub    | GitHub, Settings > Developer settings > OAuth Apps    | `https://<host>/api/auth/callback/github`    |
| Google    | Google Cloud console, APIs & Services > Credentials   | `https://<host>/api/auth/callback/google`    |
| Microsoft | Microsoft Entra admin center, App registrations (Web) | `https://<host>/api/auth/callback/microsoft` |

For GitHub, create an **OAuth App**, not a GitHub App: the GitHub App form asks for a
webhook URL and permissions, which sign-in doesn't use. In the OAuth App form:

- Homepage URL: `https://<host>`.
- Redirect URIs: `https://<host>/api/auth/callback/github`. The form takes up to 10, so
  one app can also list `http://localhost:3000/api/auth/callback/github` for local
  development.
- Leave **Allow wildcard matching** and **Enable Device Flow** off. **Expire user access
  tokens** can stay on: the app uses GitHub's token only at sign-in and then keeps its
  own session.

Google and Microsoft also list several redirect URLs in one app. For Microsoft account
types and `MICROSOFT_TENANT_ID`, see `architecture.md` ("Sign-in methods").

Google publishes an External app only with a privacy policy link. Under **Google Auth
Platform > Branding**, enter `https://<host>/privacy` and `https://<host>/terms`, and add
the host's domain under **Authorized domains**. Both pages name Snowhound OÜ as the
operator, so a stack someone else runs changes `COMPANY` in
`src/features/legal/legal-layout.tsx` and the documents' text first.

Copy each provider's client ID and secret. GitHub shows a client secret only once, right
after you generate it.

## 5. Let CI migrate the database

After the checks pass on a push to `main`, the `migrate-prod` job in
`.github/workflows/ci.yml` runs `bun run db:migrate` against the production database.
Until its secrets are set, the job skips and leaves a notice in the run summary.

1. In the GitHub repository, open **Settings > Environments** and create `production`
   (the first CI run on `main` may already have created it).
2. Add the secrets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from step 1. Repository
   secrets (**Settings > Secrets and variables > Actions**) also work, because a job
   reads them as well as its environment's. Environment secrets add a branch rule: under
   **Deployment branches and tags**, allow only `main`.
3. Re-run the latest workflow on `main`, or push to it. The `migrate-prod` job applies
   every migration to the empty database.

To migrate from your machine instead, for example before CI is set up in a fork:

```bash
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... bun run db:migrate
```

Vercel deploys a push while CI is still running, so new code can go live about a minute
before its migration applies. Keep migrations backward compatible (`migrations.md`).

## 6. Set the environment variables and redeploy

1. Generate the auth secret. Better Auth signs sessions with it, so changing it later
   signs everyone out.

   ```bash
   bunx --bun @better-auth/cli secret     # BETTER_AUTH_SECRET, at least 32 characters
   ```

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

   `.env.example` lists the same variables. `src/env.ts` checks them when the app starts
   and names the variable that is missing or set without its pair. Don't prefix a secret
   with `VITE_`: those variables reach the browser bundle.

3. Leave Preview environment variables unset. Preview deployments have generated hosts,
   where OAuth and passkeys can't work (`architecture.md`, "Sign-in methods").
4. Redeploy the latest production deployment, so it runs with the region and variables.
   Vercel applies both only to deployments made after the change.

## 7. Check the deployment

- Sign in with each configured provider, and create an organization.
- Add a passkey in Settings, sign out, and sign in with it.
- In the browser's developer tools, the console shows no Content-Security-Policy
  violations.
- With Upstash configured, keys starting with `rate-limit:` appear in its data browser
  after a few writes.
- If a page fails, the function logs under the deployment in Vercel show the error,
  including the missing variable when `src/env.ts` rejects the configuration.

## Changing the host later

Moving from `<project>.vercel.app` to your own domain, for example, takes a few minutes:

1. Add the new domain in Vercel and wait for its certificate.
2. Add the new host's redirect URL to each OAuth app. GitHub, Google, and Microsoft all
   take several, so you can remove the old one once the move works.
3. Set `BETTER_AUTH_URL` to the new host and redeploy.

OAuth accounts and all data carry over. Passkeys don't: a passkey is bound to the host it
was registered on, so users add theirs again on the new host.
