# Deployment

Snowtime runs on one of two targets, from the same code and configured only through
environment variables. Each has a runbook that sets up one production stack from scratch,
for your own deployment or for a dedicated stack per client:

- [Vercel and Turso](vercel.md): Vercel Functions with a Turso database, optional Upstash
  Redis, and CI that migrates and deploys.
- [Self-hosted](self-hosted.md): one Linux server running the app with its SQLite database
  in the same process, Caddy in front, and Litestream backups. Any VM or machine with
  systemd works; the runbook uses Hetzner as the example.

Both runbooks link here for the steps they share: the OAuth apps, the environment
variables, and changing the host. The reasons behind the choices are in
`../architecture.md` ("Environments and deployment"), and each platform's limits are in
`../hosting.md`.

## Choose a target

|                   | Vercel and Turso                                           | Self-hosted                                                      |
| ----------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Cost              | Free tiers; Vercel Hobby is non-commercial only            | A fixed monthly price for the server and the backup storage      |
| Where the data is | Turso's `aws-eu-west-1` (Ireland) at the closest in the EU | On your server, with backups in S3-compatible storage you choose |
| Page speed        | Every query is a network round trip to Turso               | Queries run in the app's process, with no network hop            |
| Scaling           | Vercel adds function instances                             | One process on one server; a bigger server is the only way up    |
| Rate-limit counts | Upstash Redis, shared by the instances                     | The process's memory                                             |
| Deploys           | CI migrates and deploys on every push to `main`            | A manual deploy: copy the release, migrate, restart (no CI job)  |
| Backups           | Turso's, as its plan provides                              | Litestream, with point-in-time restore from the bucket           |
| Operations        | None beyond the vendors' dashboards                        | OS updates, Caddy, Litestream, and watching the disk are yours   |

Pick Vercel and Turso to start at no cost for non-commercial use with nothing to operate.
Pick self-hosted for commercial use without paying for Vercel Pro, to keep data with a
provider of your choice, or for faster pages, if someone will keep the server updated.

## Other targets

The app builds with Nitro, which has presets for many other hosts. None of them is
supported or tested yet. Adding one means a runbook here, plus whatever the host needs
from this list:

- **A database next to the app.** A page makes several database queries, so the app must
  run in the same region as a remote database (Turso), or in the same process as a local
  one. A host far from the database makes every page slower.
- **The libSQL client.** Serverless and edge runtimes such as Cloudflare Workers can't
  load libSQL's native addon, so they need `@libsql/client/web` and a remote Turso
  database. A container platform can use either.
- **Shared rate-limit counts.** A host that runs several instances needs Upstash Redis,
  as Vercel does, or the limits apply per instance.
- **The client IP.** Set `CLIENT_IP_HEADER` to the header the host sets to the user's
  address.

Cloudflare as a proxy in front of the self-hosted server is already supported; running
the app on Cloudflare Workers isn't.

## Set the environment variables

Both targets read the same variables. `.env.example` lists them, and `src/env.ts` checks
them when the app starts and names the variable that is missing or set without its pair.
Don't prefix a secret with `VITE_`: those variables reach the browser bundle.

| Variable                                             | Value                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`             | The Turso database, or `file:<path>` and no token self-hosted |
| `BETTER_AUTH_SECRET`                                 | See below                                                     |
| `BETTER_AUTH_URL`                                    | `https://<host>`, no trailing slash                           |
| `<PROVIDER>_CLIENT_ID`, `<PROVIDER>_CLIENT_SECRET`   | [The OAuth apps](#register-the-oauth-apps), both or neither   |
| `MICROSOFT_TENANT_ID`                                | Optional, restricts Microsoft sign-in                         |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Vercel only, optional, both or neither                        |
| `CLIENT_IP_HEADER`                                   | Self-hosted: `cf-connecting-ip`. Unset on Vercel              |

Generate the auth secret once per stack. Better Auth signs sessions with it, so changing it
later signs everyone out.

```bash
bunx --bun @better-auth/cli secret     # BETTER_AUTH_SECRET, at least 32 characters
```

## Register the OAuth apps

Register them once you know the app's host (`<host>`). Production has no password sign-in, and a passkey can only be added to an existing
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
types and `MICROSOFT_TENANT_ID`, see `../architecture.md` ("Sign-in methods").

For Microsoft, also add the `xms_edov` optional claim, which says the account's tenant has
verified its email domain. In the app registration, open **Token configuration**, choose
**Add optional claim**, pick the **ID** token type, and select `xms_edov`. Without it, the
app refuses work and school accounts at sign-up, because Microsoft doesn't otherwise say
their address is verified; personal Microsoft accounts sign up either way. See
`../architecture.md` ("Sign-in methods").

Google publishes an External app only with a privacy policy link. Under **Google Auth
Platform > Branding**, enter `https://<host>/privacy` and `https://<host>/terms`, and add
the host's domain under **Authorized domains**. Both pages name Snowhound OÜ as the
operator, so a stack someone else runs changes `COMPANY` in
`src/features/legal/legal-layout.tsx` and the documents' text first.

Copy each provider's client ID and secret. GitHub shows a client secret only once, right
after you generate it.

## Check the deployment

- Sign in with each configured provider, and create an organization.
- Add a passkey in Settings, sign out, and sign in with it.
- In the browser's developer tools, the console shows no Content-Security-Policy
  violations.

## Changing the host later

Moving from `<project>.vercel.app` to your own domain, for example, takes a few minutes:

1. Point the new host at the app and wait for its certificate: in Vercel, add the domain;
   self-hosted, add the DNS record and the host to the Caddyfile.
2. Add the new host's redirect URL to each OAuth app. GitHub, Google, and Microsoft all
   take several, so you can remove the old one once the move works.
3. Set `BETTER_AUTH_URL` to the new host, then redeploy on Vercel or restart the app
   self-hosted.

OAuth accounts and all data carry over. Passkeys don't: a passkey is bound to the host it
was registered on, so users add theirs again on the new host.
