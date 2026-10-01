# Deploy with Docker Compose

Run Snowtime on your Hetzner machine with two services: Caddy for HTTPS and static
files, and one app process with local SQLite. Cloudflare can cache the static files
in front of Caddy. This setup follows the standalone architecture and the Caddy and
app pattern used by minupatsient. Backups are deferred for this demo deployment.

The commands below assume Debian 13, an SSH user with sudo, and an x64 or Arm64
machine. On Ubuntu, install Docker from its
[Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/), then continue
at step 2. The server needs no Bun or Node installation. Allow about 4 GB of RAM
for building; runtime requirements are in [Hosting](../hosting.md#self-hosted-one-linux-server).

## 1. Prepare the server

Connect over SSH and update the OS:

```bash
ssh <user>@<server-ip>
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git openssl unattended-upgrades
```

In the Hetzner firewall, allow SSH from your administration addresses and TCP 80,
TCP 443, and UDP 443 for web traffic. Ensure those ports are free on this machine.
Only Caddy publishes ports; the app is reachable inside the Compose network.
Docker's published ports bypass UFW, so use the Hetzner firewall for these rules.

Install Docker Engine and Compose from Docker's repository. These commands follow
the [official Debian installation guide](https://docs.docker.com/engine/install/debian/).
If Docker is already installed, check `sudo docker compose version` and skip installation.

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

## 2. Set up DNS and Cloudflare

In the Cloudflare zone for `snowhound.eu`:

1. Add an A record for `snowtime-internal` pointing at the server's IPv4 address.
   Add an AAAA record only if IPv6 reaches the server too.
2. Enable the proxy (orange cloud).
3. Set SSL/TLS encryption to **Full (strict)**. Caddy obtains and renews its own
   public certificate. Keep port 80 reachable for the HTTP certificate challenge
   and allow `/.well-known/acme-challenge/` through any Cloudflare access rules.
4. Keep the standard cache behavior. Do not enable a rule that caches every URL.
   If the zone already has broad caching rules, add a final rule for this hostname
   that bypasses cache except for `/assets/`, `/backgrounds/`, and `/brand/`.
   For those static paths, respect the origin's Cache-Control header.

Caddy serves hashed `/assets/` files with a one-year immutable cache lifetime and
backgrounds and brand images for one week. It marks proxied responses
`private, no-store`, including HTML, authentication, and server functions. Static
files stay on the same hostname, so the app needs no asset-domain setting or CSP change.
Cloudflare's [default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
and [cache rules](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/)
describe the settings.

The Caddyfile trusts Cloudflare's published IP ranges and replaces `CF-Connecting-IP`
with Caddy's resolved client address before forwarding to the app. A direct request
to the origin cannot choose its own rate-limit address. Keep those ranges current
from [Cloudflare's list](https://www.cloudflare.com/ips/).

For the bypass rule, use this custom expression and choose **Bypass cache**:

```text
(http.host eq "snowtime-internal.snowhound.eu" and not (
  starts_with(http.request.uri.path, "/assets/") or
  starts_with(http.request.uri.path, "/backgrounds/") or
  starts_with(http.request.uri.path, "/brand/")
))
```

Place it after broader cache rules so it overrides them. Leave the static paths
on standard caching, with Edge TTL and Browser TTL respecting origin headers. Remove
any rule that overrides those headers for this host. Purge this host's cached responses
if it was previously covered by a cache-everything rule. Keep Development Mode off
when checking CDN hits because it bypasses caching.

No Worker, APO, separate asset hostname, or Cloudflare API token is needed. Caddy
already redirects HTTP to HTTPS, so Cloudflare's Always Use HTTPS setting is optional.
If you use Cloudflare Access, WAF challenges, or redirect rules, allow the certificate
challenge path through and ensure the app's `/api/` and server-function requests can
reach the origin without an interactive challenge.

If the first certificate fails with the proxy enabled, temporarily set the DNS record
to **DNS only**, start Caddy and wait for its certificate, then enable **Proxied** again
with **Full (strict)**. Keep the certificate challenge path reachable for renewals.

## 3. Check out the branch and configure the demo

Use your normal GitHub authentication for this repository:

```bash
mkdir -p ~/projects
cd ~/projects
git clone --branch feat/compose-demo-deployment https://github.com/Snowhound/snowtime.git
cd snowtime/deploy/compose
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Copy the generated secret into `.env` as `BETTER_AUTH_SECRET`. Keep it for later
deploys; changing it signs everyone out. The initial settings are:

```dotenv
APP_HOST=snowtime-internal.snowhound.eu
RELEASE=local
DATABASE_VOLUME=snowtime_demo_data
BETTER_AUTH_SECRET=<generated-secret>
DEMO_MODE=true
```

`DEMO_MODE` is a runtime setting, so changing it requires recreating the app container,
without rebuilding. It enables seeded password sign-in, disables all OAuth providers,
and disables password sign-up. The app shows a startup notice once per browser tab
session and a persistent **Demo version** button to reopen it. Demo visitors share
accounts and can change the sample data. No OAuth credentials are needed.

Compose fixes the database URL to `file:/data/snowtime.db`, the public app URL to
`https://$APP_HOST`, and the client IP header to `cf-connecting-ip`. The app runs as
UID 10001. Its named volume retains the database and WAL across container replacements.

## 4. Build, migrate, seed, and start

Run these commands from `deploy/compose`:

```bash
sudo docker compose build --pull
sudo docker compose run --rm --no-deps app ./snowtime-migrate
sudo docker compose run --rm --no-deps app ./snowtime-seed --company
sudo docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
sudo docker compose up -d
sudo docker compose ps
sudo docker compose logs --tail=100 app caddy
```

The seed adds Northwind Studio, Harbor Consulting, and Lumen Works with about 20,000
entries across the preceding year. It refuses remote databases and refuses production
seeding unless `DEMO_MODE=true`. It does not overwrite existing data or reseed on startup.
The [seeded accounts](../development.md#seeded-users) all use `snowtime-local`.
The sign-in page lists them; choosing one fills the form. For a full-year report,
sign in as `kristiina@lumen.example.com`, Lumen Works' owner.

The Dockerfile builds native Linux executables for the server, migrator, and seeder.
Caddy's image contains the same build's precompressed public files. It pins
[Caddy 2.11.4](https://github.com/caddyserver/caddy/releases/tag/v2.11.4), the latest
stable release checked on 2026-10-01. Both images receive the same `RELEASE` tag.
Only the app and Caddy run continuously; migration and seed commands are temporary
containers using the app image. Compose enables `MIGRATE_ON_START=true`: the standalone
entry verifies and applies migrations in the app process before importing the HTTP
server. A failed migration prevents the listener from starting. The explicit first
migration above prepares the file for seeding before the first startup.

## 5. Check the deployment

Open `https://snowtime-internal.snowhound.eu` on desktop and phone:

- The demo prompt appears, and **Continue to demo** closes it. The demo button reopens it.
- The sign-in page lists sample accounts and shows no OAuth buttons.
- Sign in as Kristiina, open Reports, and select the preceding year.
- Start and stop a timer, reload, and check that the change remains.
- `sudo docker compose ps` shows the app healthy and both services running.

Check the response headers:

```bash
curl -sI https://snowtime-internal.snowhound.eu/sign-in
```

Expect `Cache-Control: private, no-store`, a Content-Security-Policy with a nonce,
Strict-Transport-Security, and a Cloudflare cache status of `DYNAMIC` or `BYPASS`.
Copy a hashed `/assets/` URL from the browser's Network panel and request it twice
with `curl -sI`. Expect the immutable cache header and eventually `CF-Cache-Status: HIT`.
There must be no cached sign-in page or authenticated response.

## 6. Deploy a later commit

Build before stopping the running app. Set `RELEASE` in `.env` to a unique value,
such as the short commit ID, so the old images remain available for rollback.

```bash
cd ~/projects/snowtime
git pull --ff-only
git rev-parse --short HEAD
cd deploy/compose
# Edit RELEASE in .env to that commit ID.
sudo docker compose build --pull
sudo docker compose stop app
sudo docker compose up -d --force-recreate
sudo docker compose ps
```

If building or startup migration fails, stop the deploy and inspect the error. The previous
Caddy keeps serving static files while the app is stopped. Do not run a second app
against the volume. Stop the app before using the seed or migration tools so they never compete
with live writes. Do not use `docker compose down -v`: it deletes the database and
Caddy's certificate storage.

To roll back the code, restore the earlier `RELEASE` value and run
`sudo docker compose up -d --no-build --force-recreate`. Keep the earlier images and
use backward-compatible migrations. A rollback does not undo schema changes.

## Move to company use later

Stop the app, set `DATABASE_VOLUME=snowtime_company_data` in `.env`, configure an
OAuth provider, and set `DEMO_MODE=false`. Run the migration command from step 4
against the fresh volume, then `sudo docker compose up -d --force-recreate`.
Do not reuse the demo's shared credentials
for company data. The regular [OAuth setup](README.md#register-the-oauth-apps) applies.
The [standalone backup guide](self-hosted.md#backups-and-restore) describes Litestream;
adding it to this Compose setup is deferred until the deployment holds real data.

To change the hostname, update `APP_HOST`, DNS, and the OAuth callbacks, then recreate
both containers. Passkeys registered on the old hostname need to be added again.
