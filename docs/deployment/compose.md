# Deploy with Docker Compose

Run Snowtime on your Hetzner machine with two services: Caddy for HTTPS and static
files, and one app process with local SQLite. Cloudflare can cache the static files
in front of Caddy. This setup follows the standalone architecture and the Caddy and
app pattern used by minupatsient. Backups are deferred for this demo deployment.

The commands below assume Debian 13, an SSH user with sudo, and an x64 machine. On
Ubuntu, install Docker from its
[Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/), then continue
at step 2. The **Compose deploy** workflow builds the images on GitHub Actions,
pushes them to GHCR, and deploys them over SSH, so the server needs no Bun, Node, or
checkout of the repository. A 1 vCPU, 2 GB server runs the demo; other runtime
requirements are in [Hosting](../hosting.md#self-hosted-one-linux-server).

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
`private, no-store`, including HTML, authentication, and the JSON API. Static
files stay on the same hostname, so the app needs no asset-domain setting or CSP change.
Cloudflare's [default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
and [cache rules](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/)
describe the settings.

The Caddyfile trusts Cloudflare's published IP ranges and replaces `CF-Connecting-IP`
with Caddy's resolved client address before forwarding to the app. A direct request
to the origin cannot choose its own rate-limit address. Keep those ranges current
from [Cloudflare's list](https://www.cloudflare.com/ips/).

Caddy answers common scanner probes itself: `TRACE` and `TRACK` get 405, and paths such
as `/wp-admin`, dotfiles other than `/.well-known/`, and backup archives get 404. Its
JSON access log leaves out TLS details, response headers, and request headers nobody
reads. Its metrics stay inside the container:
`docker compose exec caddy wget -qO- localhost:2019/metrics`.

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

## 3. Configure the demo and the deploy

On the server, let your user run Docker without sudo, which the workflow needs, and
create the deploy directory. Membership in the `docker` group is equivalent to root.

```bash
sudo usermod -aG docker "$USER"
mkdir -p ~/snowtime
openssl rand -hex 32
```

Log out and in again for the group to apply. Create `~/snowtime/.env` with
`chmod 600`, putting the generated secret in `BETTER_AUTH_SECRET`. Keep it for later
deploys; changing it signs everyone out. The workflow sets `RELEASE` on each deploy.

```dotenv
APP_HOST=snowtime-internal.snowhound.eu
RELEASE=
DATABASE_VOLUME=snowtime_demo_data
BETTER_AUTH_SECRET=<generated-secret>
DEMO_MODE=true
```

`DEMO_MODE` is a runtime setting, so changing it requires recreating the app container,
without rebuilding. It enables seeded password sign-in, disables all OAuth providers,
and disables password sign-up. A **Demo version** box on the sign-in page tells
visitors that accounts and data are shared. Demo visitors share
accounts and can change the sample data. No OAuth credentials are needed.

Compose fixes the database URL to `file:/data/snowtime.db`, the public app URL to
`https://$APP_HOST`, and the client IP header to `cf-connecting-ip`. The app runs as
UID 10001. Its named volume retains the database and WAL across container replacements.

On your own machine, make a key for the workflow and authorize it on the server:

```bash
ssh-keygen -t ed25519 -N '' -C snowtime-compose-deploy -f snowtime-deploy
ssh-copy-id -i snowtime-deploy.pub <user>@<server-ip>
ssh-keyscan -t ed25519 <server-ip>
```

Compare the scanned key with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the
server. In the repository's **Settings > Secrets and variables > Actions**, add these
repository secrets:

| Secret                    | Value                                                 |
| ------------------------- | ----------------------------------------------------- |
| `COMPOSE_DEPLOY_HOST`     | The server's IP address or SSH hostname               |
| `COMPOSE_DEPLOY_USER`     | Your SSH user                                         |
| `COMPOSE_DEPLOY_PATH`     | The deploy directory, such as `/home/<user>/snowtime` |
| `COMPOSE_SSH_PRIVATE_KEY` | The contents of `snowtime-deploy`                     |
| `COMPOSE_SSH_KNOWN_HOSTS` | The `ssh-keyscan` line                                |

Delete the local key files afterwards. GitHub's runners connect from changing
addresses, so the server's firewall must allow SSH from anywhere. Keep password login
disabled (`PasswordAuthentication no` in `/etc/ssh/sshd_config`). Anyone who can push a
branch can run a workflow that reads these secrets, so write access to the repository
amounts to access to the server.

## 4. Deploy, seed, and start

In the repository's **Actions** tab, open **Compose deploy**, choose **Run workflow**,
pick the branch, and keep **restart**. To deploy `main` after every push once its checks
pass, set the repository variable `COMPOSE_AUTO_DEPLOY` to `true` (**Settings > Secrets and
variables > Actions > Variables**). A fork without the variable builds nothing. From a terminal:

```bash
gh workflow run compose-deploy.yml --ref feat/compose-demo-deployment -f server=restart
```

The workflow builds the app and Caddy images, and the load benchmark's sampler, pushes
them to GHCR, copies the Compose files to the server (`compose.yml`, `compose.import.yml`,
and the benchmark's `compose.bench.yml` and `bench/`), pulls the images with the job's
token, and restarts the app. It waits for the app's health check and fails if the app doesn't
become healthy. The first start creates and migrates an empty database. Seed it on the
server:

```bash
cd ~/snowtime
docker compose stop app
docker compose run --rm --no-deps app ./snowtime-seed --company
docker compose up -d --wait
docker compose logs --tail=100 app caddy
```

The seed adds Northwind Studio, Harbor Consulting, and Lumen Works with about 20,000
entries across the preceding year. It refuses remote databases and refuses production
seeding unless `DEMO_MODE=true`. It does not overwrite existing data or reseed on startup.
The [seeded accounts](../development.md#seeded-users) all use `snowtime-local`.
The sign-in page lists them; choosing one fills the form. For a full-year report,
sign in as `kristiina@lumen.example.com`, Lumen Works' owner.

The Dockerfile builds native Linux executables for the server, migrator, seeder, and
importer. Caddy's image contains the same build's precompressed public files. It pins
[Caddy 2.11.4](https://github.com/caddyserver/caddy/releases/tag/v2.11.4), the latest
stable release checked on 2026-10-01. Both images are tagged with the commit's short
ID, which `RELEASE` selects.
Only the app and Caddy run continuously; migration and seed commands are temporary
containers using the app image. Compose enables `MIGRATE_ON_START=true`: the standalone
entry verifies and applies migrations in the app process before importing the HTTP
server. A failed migration prevents the listener from starting, and the workflow fails.

`compose.yml` sets no CPU or memory limits. Its commented-out `deploy` blocks show
caps for sharing a larger host with other services; `docker stats` shows what the
containers use.

## 5. Check the deployment

Open `https://snowtime-internal.snowhound.eu` on desktop and phone:

- The sign-in page shows the **Demo version** box.
- The sign-in page lists sample accounts and shows no OAuth buttons.
- Sign in as Kristiina, open Reports, and select the preceding year.
- Start and stop a timer, reload, and check that the change remains.
- `docker compose ps` shows the app healthy and both services running.

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

Run **Compose deploy** again on the branch; it deploys the branch's latest commit. The
build finishes before the app stops, and each deploy sets a new `RELEASE`, so earlier
images stay on the server and in GHCR for rollback.

If the build or startup migration fails, inspect the workflow log and
`docker compose logs app`. Caddy keeps serving static files while the app is stopped.
Do not run a second app against the volume. Stop the app before using the seed or
migration tools so they never compete with live writes. Do not use
`docker compose down -v`: it deletes the database and Caddy's certificate storage.

To roll back the code, set `RELEASE` in `.env` to an earlier commit's short ID and run
`docker compose up -d --no-build --force-recreate --wait`. Use backward-compatible
migrations: a rollback does not undo schema changes. To build on the server instead,
run `docker compose build` from `deploy/compose` in a checkout of the repository.

## Move to company use later

`ALLOWED_LOGIN_DOMAINS=snowhound.eu` restricts every sign-in method to that exact
email domain and shows an **Internal use only** box on the sign-in page. Separate domains
with commas; case and a leading `@` are ignored. Subdomains need their own entries.
Existing sessions outside the list lose access. The app refuses to start with both
`DEMO_MODE=true` and `ALLOWED_LOGIN_DOMAINS` set, because the seeded users have
`example.com` addresses.

Stop the app, set `DATABASE_VOLUME=snowtime_company_data` in `.env`, configure an
OAuth provider, and set `DEMO_MODE=false`. Then run
`docker compose up -d --force-recreate --wait`; startup migrates the fresh volume.
Do not reuse the demo's shared credentials
for company data. The regular [OAuth setup](README.md#register-the-oauth-apps) applies.
The [standalone backup guide](self-hosted.md#backups-and-restore) describes Litestream;
adding it to this Compose setup is deferred until the deployment holds real data.

To change the hostname, update `APP_HOST`, DNS, and the OAuth callbacks, then recreate
both containers. Passkeys registered on the old hostname need to be added again.

## Import an existing cloud company

The importer is optional. It runs on this server while the destination app is
offline and reads the source through a Turso read transaction. It refuses an
existing destination database or SQLite sidecar; use a fresh volume. Do not run
the seed or migration command on that volume before importing.

Run **Compose deploy** with **pull only**, so the server has the images without
restarting the app. Then, in `~/snowtime`, stop the app and create `.env.import`:

```bash
docker compose stop app
touch .env.import
chmod 600 .env .env.import
```

Set these values in `.env`:

```dotenv
DEMO_MODE=false
DATABASE_VOLUME=snowtime_company_data
ALLOWED_LOGIN_DOMAINS=snowhound.eu
```

Keep `TURSO_DATABASE_URL=file:/data/snowtime.db`. Configure the intended OAuth
provider and its callback URL before enabling company logins. Set the source
URL and a read-only Turso token in `.env.import`:

```dotenv
IMPORT_SOURCE_DATABASE_URL=libsql://your-cloud-database.turso.io
IMPORT_SOURCE_AUTH_TOKEN=your-read-only-token
```

This file stays on the server. Only the import override
passes its credentials into a temporary container; normal startup does not use it.
Use the override only with `run`: `up` with it would give the running app the token.
Create the token with `turso db tokens create DATABASE --read-only`
([Turso token reference](https://docs.turso.tech/cli/db/tokens/create)).

```bash
docker compose -f compose.yml -f compose.import.yml run --rm --no-deps -it app ./snowtime-import
```

The script asks you to confirm that all destination writers are stopped, choose
the same or a different hostname, and choose cleanup for sessions, verification
challenges, passkeys, and stored OAuth tokens. It lists the source companies:
select **Snowhound OÜ** by number to import only that company, or explicitly type
`ALL` to import every company. Type `IMPORT` for the final confirmation.

A company import includes its teams, members, projects, invitations, and time
entries, including archived and deleted records. It includes the users and audit
actors those records require, and company users' settings and login accounts.
Shared users' other company memberships and work are excluded. Verification
challenges are always excluded from a company import because they cannot be
reliably assigned to one company. New unknown tables cause company filtering to
fail until the importer is updated.

Clearing sessions and OAuth tokens defaults to yes. OAuth account links and
password hashes remain, so users can authenticate again. Passkey cleanup defaults
to yes for a different hostname and no for the same hostname; passkeys tied to the
old hostname need registration again. Use a new `BETTER_AUTH_SECRET` for this
instance and clear old sessions. The importer verifies migration hashes, copies
into a temporary file, checks integrity and foreign keys, then publishes the file
without overwriting an existing database. Failed imports leave no destination.

After a successful import, start with the normal configuration:

```bash
docker compose up -d --force-recreate
docker compose logs --tail=100 app
```

Startup applies any pending migrations before accepting requests. Verify company
access and records before switching users over. For a final move, stop cloud
writes before importing: writes made after the read snapshot starts are not
included. The script never modifies the cloud database. Keep the source available
until you have checked the move. Remove `.env.import` and revoke its token when
finished. Arrange backups before using the destination for company work.

## Run the load benchmark

The load benchmark (`perf/README.md`, "Load benchmark") measures this server under the
usage model. While it runs, the demo is offline: the bench stack serves a dataset from a
volume of its own, `snowtime_bench_data`, and the demo's volume stays untouched. The load
generator runs on your own machine, sends requests straight to the server's address past
Cloudflare, and reads the sampler through Caddy with a password. It never connects to the
server otherwise.

1. Deploy a release that contains the benchmark (step 4). The workflow publishes the
   sampler image and copies `compose.bench.yml` and `bench/` with the other Compose files.
2. On your machine, generate the dataset on the day of the run. The data ends at the
   moment it's generated, and the load generator needs the users file from the same run:

   ```bash
   bun perf/stress/dataset.ts M
   scp perf/.cache/stress/M-<date>-<hash>.db <user>@<server-ip>:~/snowtime/bench.db
   ```

3. On the server, add the benchmark's settings to `~/snowtime/.env`. Pick a sampler
   password and hash it; in `.env`, double each `$` of the hash:

   ```bash
   openssl rand -hex 32
   docker run --rm caddy:2.11.4 caddy hash-password --plaintext '<sampler-password>'
   ```

   ```dotenv
   BENCH_GENERATOR_IP=<your machine's public IPv4 address>
   BENCH_AUTH_SECRET=<the generated secret>
   BENCH_SAMPLER_HASH=<the hash, each $ doubled>
   ```

   Caddy trusts `CF-Connecting-IP` from `BENCH_GENERATOR_IP`, so each simulated user
   counts as its own address in the rate limits.

4. Load the dataset while the app is stopped, empty the page cache so the run starts from
   the disk, and start the bench stack:

   ```bash
   cd ~/snowtime
   docker compose stop app
   docker compose -f compose.yml -f compose.bench.yml up -d --no-start
   docker run --rm -v snowtime_bench_data:/data -v ~/snowtime:/source:ro alpine sh -c \
     'rm -f /data/snowtime.db* && cp /source/bench.db /data/snowtime.db && chown -R 10001:10001 /data'
   sync && echo 3 | sudo tee /proc/sys/vm/drop_caches
   docker compose -f compose.yml -f compose.bench.yml up -d --wait
   ```

5. If the Hetzner firewall limits TCP 443 to Cloudflare's ranges, allow your machine's
   address too.
6. On your machine, run the benchmark with the same secret and the sampler password:

   ```bash
   export BENCH_HOST=snowtime-internal.snowhound.eu BENCH_ORIGIN_IP=<server-ip>
   export BENCH_AUTH_SECRET=<the generated secret> BENCH_SAMPLER_PASSWORD=<sampler-password>
   bun run perf:stress --remote --dataset=M --run=calibration
   bun run perf:stress --remote --dataset=M --run=ramp
   ```

   A ramp on the server stops at the first step that misses a target for 30 seconds, or
   when memory passes 85% or the disk 80%, and then drops the load two steps.

7. Bring the demo back, and remove the benchmark's data and request log:

   ```bash
   docker compose up -d --wait --remove-orphans
   docker volume rm snowtime_bench_data snowtime_bench_log
   rm ~/snowtime/bench.db
   ```
