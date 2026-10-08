# Deploy on your own Linux server

For Caddy and the app in containers, use the [Docker Compose guide](compose.md).
It includes the Hetzner demo setup and Cloudflare static asset caching.

This runbook sets up one production stack on a single Linux server: the app as one
process with its SQLite database in the same process, Caddy in front of it for HTTPS and
static files, Litestream streaming the database to S3-compatible storage, and optionally
Cloudflare's proxy in front of Caddy. Any VM, dedicated server, or machine on premises
that meets the [server requirements](#server-requirements) works. Hetzner Cloud is the
worked example.

[The deployment index](README.md) compares this with Vercel and Turso and holds the steps
both share. The constraints behind the setup are in `../hosting.md` ("Self-hosted"), and
the files this runbook installs are in `deploy/self-hosted/`:

| File                 | Installed as                             | What it does                                     |
| -------------------- | ---------------------------------------- | ------------------------------------------------ |
| `Caddyfile`          | `/etc/caddy/Caddyfile`                   | HTTPS, static files, compression, headers, proxy |
| `snowtime.service`   | `/etc/systemd/system/snowtime.service`   | Runs the app as the unprivileged `snowtime` user |
| `litestream.yml`     | `/etc/litestream.yml`                    | Replicates the database to the bucket            |
| `litestream.service` | `/etc/systemd/system/litestream.service` | Runs Litestream as `snowtime`                    |

## Two ways to run the app

The build contains the libSQL addon for one platform only, so it runs only on the
operating system and architecture it was built for. The two ways differ in where the build
happens. Both use the same Caddyfile, unit, backups, and migrations; only the unit's
`ExecStart` differs.

- **Compiled release** (recommended). `bun run build:binary` on your machine or in CI
  makes one release per architecture in `dist/snowtime-linux-<arch>/`: the server as one
  executable (about 100 MB, with the Bun runtime and bytecode), `snowtime-migrate`,
  `drizzle/`, and `public/`. The server needs no Bun or Node, and the build doesn't use
  its CPU or memory.
- **Build on the server.** A checkout on the server runs `bun install` and
  `bun run build:self-hosted`, and the unit runs `bun .output/server/index.mjs`. The
  server needs Bun, 2 GB of dependencies, and the memory to build.

In `perf:load`, both ran within noise of each other.

## Server requirements

- **OS:** Linux with systemd and glibc, x64 or Arm64. Tested on Debian 13 (in a
  container); Ubuntu 24.04 should work the same way.
- **CPU:** at least 1 vCPU; 2 recommended. The app uses one core, and Caddy, Litestream,
  and the OS get the other.
- **Memory:** at least 2 GB; 4 GB recommended. The app peaked near 400 MB under load, and
  building on the server needs more.
- **Disk:** 20 GB lasts for years (see below).
- **Network:** a public IPv4 or IPv6 address; inbound TCP 80 and 443, and UDP 443 for
  HTTP/3; outbound HTTPS to the OAuth providers and the bucket.
- **Software:** Caddy 2.11 or later and Litestream 0.5. Bun, at the version in
  `package.json`'s `packageManager`, only to build on the server.
- **Region:** close to the users. Every request goes to this one server, so its distance
  from them adds to every page.

Alpine and other musl systems don't fit: `build:binary` makes glibc executables. Bun on
Alpine ran the app built on the server in a test, but Alpine uses OpenRC, not systemd, so
the unit files don't apply.

**CPU and memory, measured.** `bun run perf:load` on 2026-09-30, in a Linux Arm64 VM
limited to 2 CPUs on an M1 Pro, with the Lumen Works seed (19 people, 20,900 entries):

| Page              | p50   | CPU per request | Requests per second at 10 concurrent |
| ----------------- | ----- | --------------- | ------------------------------------ |
| Timer             | 30 ms | 27–43 ms        | 42                                   |
| Settings          | 31 ms | 17–31 ms        | 61                                   |
| Reports, week     | 21 ms | 21–23 ms        | 49                                   |
| Reports, 9 months | 76 ms | 85–92 ms        | 12                                   |

The compiled server uses 82 MB after it starts, 91 MB after the first page, and peaked at
383 MB under that load. A shared cloud vCPU is likely slower than an M1 Pro core, so plan
on 20–40 ordinary pages per second from one server. `perf:load` on the real server gives
its own numbers ([Measure the server](#measure-the-server)).

**Disk.** The database takes about 640 bytes per time entry, indexes included: 13.5 MB
for the seed's 20,900 entries. A person logging 5 entries a working day adds under 1 MB a
year, so 1,000 people take about 1 GB a year. Beside it: the WAL (a few MB), Litestream's
local state (small, uploaded every second), about 230 MB per compiled release (the
executables and `public/`), and the journal's logs. Keep two or three releases for
rollback. Building on the server adds about 2 GB for `node_modules`.

### Example: Hetzner Cloud

A CX23 (x64) or CAX11 (Arm64) shared plan, both 2 vCPU, 4 GB, and 40 GB, meets the
recommended size; check the current price on Hetzner's site. Pick the location closest to
your users: `hel1` (Helsinki) for Estonia and Finland, `fsn1` or `nbg1` (Germany) for
central Europe. Put the backup bucket in Hetzner Object Storage in another location, so
one site's outage doesn't take both. Cloudflare R2 or any other S3-compatible storage works
the same way.

## Before you start

- A server as above, with SSH access as a user with `sudo`, and a domain whose DNS you
  control. The next steps write the app's host as `<host>`.
- An S3-compatible bucket and an access key for it: the endpoint URL, region, bucket
  name, key ID, and secret. On Hetzner, create the bucket under **Object Storage** and a
  key under **Security > S3 credentials**; the endpoint is
  `https://<location>.your-objectstorage.com` and the region is the location, such as
  `fsn1`.
- The OAuth apps for `<host>` ([Register the OAuth apps](README.md#register-the-oauth-apps)).

## 1. Prepare the server

Keep the OS patched and open only SSH and the web ports:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades sqlite3 curl
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw enable
```

On Hetzner, a Cloud Firewall with the same rules does the job outside the server.

Create the user the app runs as, and the folders:

```bash
sudo useradd --system --home-dir /var/lib/snowtime --shell /usr/sbin/nologin snowtime
sudo install -d -m 0755 /opt/snowtime/releases
sudo install -d -o root -g snowtime -m 0750 /etc/snowtime
sudo install -d -o snowtime -g snowtime -m 0750 /var/lib/snowtime
```

| Path                           | Holds                                                       |
| ------------------------------ | ----------------------------------------------------------- |
| `/opt/snowtime/releases/<v>`   | One release per deploy, never changed after it's copied     |
| `/opt/snowtime/current`        | A symlink to the running release; Caddy and the unit use it |
| `/var/lib/snowtime`            | The database, its WAL, and Litestream's state               |
| `/etc/snowtime/env`            | The app's settings and secrets                              |
| `/etc/snowtime/litestream.env` | The bucket's credentials, which the app never sees          |

## 2. Install Caddy and Litestream

Install Caddy from its own Debian repository, which carries the current release (Debian's
own package is older than 2.11):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
caddy version   # 2.11 or later
```

Install Litestream from its [releases](https://github.com/benbjohnson/litestream/releases),
choosing `x86_64` or `arm64` to match the server:

```bash
curl -fsSLO https://github.com/benbjohnson/litestream/releases/download/v0.5.17/litestream-0.5.17-linux-arm64.deb
sudo dpkg -i litestream-0.5.17-linux-arm64.deb
```

## 3. Write the settings

Create `/etc/snowtime/env` with the variables from
[Set the environment variables](README.md#set-the-environment-variables):

```bash
TURSO_DATABASE_URL=file:/var/lib/snowtime/snowtime.db
BETTER_AUTH_SECRET=<bunx --bun @better-auth/cli secret>
BETTER_AUTH_URL=https://<host>
CLIENT_IP_HEADER=cf-connecting-ip
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Leave `TURSO_AUTH_TOKEN` and the Upstash variables out. Rate-limit counts stay in the
process's memory, which is correct with one process. Keep `CLIENT_IP_HEADER` even without
Cloudflare: Caddy always sets that header to the address it trusts, so Better Auth's
per-IP limits see each user.

Create `/etc/snowtime/litestream.env` with the bucket:

```bash
LITESTREAM_ENDPOINT=https://fsn1.your-objectstorage.com
LITESTREAM_REGION=fsn1
LITESTREAM_BUCKET=<bucket>
LITESTREAM_ACCESS_KEY_ID=...
LITESTREAM_SECRET_ACCESS_KEY=...
```

Let only root and the `snowtime` group read them:

```bash
sudo chown root:snowtime /etc/snowtime/env /etc/snowtime/litestream.env
sudo chmod 0640 /etc/snowtime/env /etc/snowtime/litestream.env
```

## 4. Install the configuration

From a checkout of the repository on your machine, copy the files to the server, then
install them there:

```bash
scp deploy/self-hosted/* <server>:/tmp/
```

```bash
sudo install -m 0644 /tmp/snowtime.service /tmp/litestream.service /etc/systemd/system/
sudo install -m 0644 /tmp/litestream.yml /etc/litestream.yml
sudo install -m 0644 /tmp/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/snowtime.example.com/<host>/' /etc/caddy/Caddyfile
sudo systemctl daemon-reload
```

To build on the server, also change `ExecStart` with a drop-in, so the unit file stays as
the repository has it:

```bash
sudo systemctl edit snowtime
# [Service]
# ExecStart=
# ExecStart=/usr/local/bin/bun /opt/snowtime/current/server/index.mjs
```

## 5. Point the domain at the server

Create an `A` record (and `AAAA` for IPv6) for `<host>` with the server's address. Once
Caddy runs with the Caddyfile, it gets a Let's Encrypt certificate on its own and
redirects HTTP to HTTPS.

With Cloudflare, create the record as **DNS only** first, and turn the proxy on once
`https://<host>` works, so the first certificate doesn't depend on the proxy. Then:

- Under **SSL/TLS**, set the mode to **Full (strict)**, so Cloudflare checks Caddy's
  certificate.
- Caddy trusts `CF-Connecting-IP` only from Cloudflare's addresses, which the Caddyfile
  lists (`trusted_proxies`). Cloudflare publishes them at
  [cloudflare.com/ips](https://www.cloudflare.com/ips/); compare them now and then.
- Requests that skip Cloudflare still work, and Caddy then uses their own address, so
  nobody can choose the address the rate limits count. To accept only Cloudflare, limit
  TCP 443 to its ranges in the firewall; keep port 80 open for certificate renewals.

Behind the proxy, browsers speak HTTP/3 to Cloudflare, and Cloudflare speaks HTTP/1.1 or
HTTP/2 to Caddy. The Caddyfile's HTTP/3 serves a domain that isn't proxied.

## 6. Deploy a release

Every deploy has the same four steps: copy a new release, migrate the database, switch
`current` to the release, and restart the app. Migrations run before the restart and never
at app start (`../architecture/platform.md`, "Environments and deployment"), and the previous
release keeps running against the migrated database until the restart, so migrations stay
backward compatible (`../migrations.md`). Caddy holds requests for up to 30 seconds while
the app restarts, so users see a pause of about a second rather than an error.

Name each release after its commit, for example `v=$(git rev-parse --short HEAD)`.

### Compiled release

On your machine, in the repository at the commit to deploy. The first command installs
the Linux libSQL addon beside your own, once per architecture:

```bash
bun install --os=linux --cpu=arm64      # or --cpu=x64
bun run build:binary --target=arm64
rsync -a dist/snowtime-linux-arm64/ <server>:/tmp/snowtime-$v/
```

On the server:

```bash
sudo mv /tmp/snowtime-$v /opt/snowtime/releases/$v && sudo chown -R root:root /opt/snowtime/releases/$v
sudo systemd-run --quiet --wait --pipe -p User=snowtime -p EnvironmentFile=/etc/snowtime/env \
  /opt/snowtime/releases/$v/snowtime-migrate
sudo ln -sfn /opt/snowtime/releases/$v /opt/snowtime/current
sudo systemctl restart snowtime
```

`snowtime-migrate` checks the applied migrations as `db:verify` does, then applies the new
ones from the release's `drizzle/`. `build:binary` fails with the install command if the
target's `@libsql/linux-<arch>-gnu` package is missing.

### Build on the server

Install Bun where the unit expects it, once, at the version `package.json` names:

```bash
curl -fsSL https://bun.sh/install | sudo BUN_INSTALL=/usr/local bash -s "bun-v1.4.2"
```

Keep a checkout owned by a deploy user, for example in `/opt/snowtime/src`, and for each
deploy:

```bash
cd /opt/snowtime/src && git pull && v=$(git rev-parse --short HEAD)
bun install --frozen-lockfile
bun run build:self-hosted
sudo cp -R .output /opt/snowtime/releases/$v
sudo systemd-run --quiet --wait --pipe -p User=snowtime -p EnvironmentFile=/etc/snowtime/env \
  -p WorkingDirectory=/opt/snowtime/src /usr/local/bin/bun run db:migrate
sudo ln -sfn /opt/snowtime/releases/$v /opt/snowtime/current
sudo systemctl restart snowtime
```

The release is a copy of `.output`, so the next build can't change files under the running
app.

### First deploy

The first deploy creates the database: the migrations apply to an empty file. Then start
everything and make it start at boot:

```bash
sudo systemctl enable --now snowtime litestream
sudo systemctl reload caddy
systemctl status snowtime litestream caddy
```

### Roll back

Point `current` at the previous release and restart. Its code runs against the newer
schema, which works while migrations stay backward compatible:

```bash
sudo ln -sfn /opt/snowtime/releases/<previous> /opt/snowtime/current
sudo systemctl restart snowtime
```

Remove releases you won't roll back to, keeping two or three.

## 7. Check the deployment

Everything in [Check the deployment](README.md#check-the-deployment) applies, plus:

- `systemctl status snowtime litestream caddy` shows all three active, and
  `journalctl -u snowtime` shows `Listening on: http://127.0.0.1:3000/`.
- `curl -sI https://<host>/sign-in` shows `strict-transport-security`,
  `content-security-policy` with a nonce, and no `server` header.
- After signing in, the newest session's address is yours, not Cloudflare's:
  `sudo -u snowtime sqlite3 /var/lib/snowtime/snowtime.db "select ip_address from session order by created_at desc limit 1"`.
- `journalctl -u litestream` shows `snapshot complete`, and the bucket holds a
  `snowtime/` folder.

Logs go to the journal, Caddy's as JSON: `journalctl -u caddy -o cat | jq`. Limit the
journal's size with `SystemMaxUse=` in `/etc/systemd/journald.conf` if the disk is small.

## Startup migrations

Compiled releases can set `MIGRATE_ON_START=true` and
`MIGRATIONS_DIR=/opt/snowtime/current/drizzle` in `/etc/snowtime/env`. The server
verifies and applies migrations inside its process before opening the listener.
A failure prevents startup. Stop the old process before starting the new release;
there must never be two app processes on the file. This avoids task 043's conflict
between a live server and a separate migration writer, including migrations that
take more than five seconds.

For builds run with Bun, use `bun run start:self-hosted` from the checkout, with
`MIGRATIONS_DIR` pointing at that checkout's `drizzle/`. Running Nitro's `index.mjs`
directly bypasses the migration entry. The default is `MIGRATE_ON_START=false`, so
the existing explicit migration procedure remains available. Compose enables it.

### Database engine and backup options

Task 043's libSQL binding issue can lose later writes after `SQLITE_BUSY`: a connection
can read its own successful-looking writes while other connections cannot see them,
and closing it rolls them back. The repro did not show malformed database files.
The app's statement queue prevents its requests from causing that conflict, but a
second writer can still cause it. Startup migrations remove that competing writer.

Running migrations and seeding in the same process with Turso's engine would remove
task 077's file-sharing obstacle. It does not establish that the engine is ready for
company data: rerun the application tests, concurrency tests, foreign-key checks, and
restore tests before adopting it. The current deployment keeps libSQL.

Turso Sync supports explicit `push()`, `pull()`, and `sync()` calls, so a periodic
push can maintain a remote copy. Outages delay replication, and unwanted changes
replicate too, so recovery history needs a separate retention policy. The project's
[sync API](https://github.com/tursodatabase/turso/blob/main/bindings/javascript/sync/README.md)
still recommends backups. An [open restore issue](https://github.com/tursodatabase/turso/issues/8129),
reproduced with 0.7.1, reports that restoring an old client's files makes later pushes
silently skip writes. Whether it affects the evaluated 0.8.1 needs a restore test.

For libSQL, [Litestream](https://litestream.io/how-it-works/) provides continuous WAL
replication and recovery history. SQLite's [backup API](https://www.sqlite.org/backup.html)
is another way to produce consistent snapshots. Neither option's compatibility with
Turso's rewritten engine has been established by this repository.

## Backups and restore

Litestream copies each change to the bucket within a second and writes a full snapshot a
day, kept for a week (`litestream.yml`). A restore can go back to any moment in that week.
Run exactly one Litestream per bucket path: two servers replicating to the same path can
make it impossible to restore.

List what the bucket holds:

```bash
sudo -u snowtime sh -c 'set -a; . /etc/snowtime/litestream.env; litestream ltx -config /etc/litestream.yml /var/lib/snowtime/snowtime.db'
```

### Restore onto a fresh server

Tested on 2026-09-30 with a fresh Debian 13 server in Docker and an S3 stand-in: the
restore brought back the last change written before the old server stopped.

1. Stop the old server's `snowtime` and `litestream`, if it still runs, so only one server
   writes to the bucket.
2. On the new server, follow steps 1 to 4, and copy a release as in step 6 without
   migrating or starting anything.
3. Restore the database as the `snowtime` user:

   ```bash
   sudo -u snowtime sh -c 'set -a; . /etc/snowtime/litestream.env; litestream restore -config /etc/litestream.yml -if-replica-exists /var/lib/snowtime/snowtime.db'
   ```

4. Migrate, switch `current`, and start as in step 6 ("First deploy"). Litestream then
   continues replicating to the same path.
5. Point the DNS record at the new server.

To look at an earlier state without touching the live database, restore to another file:
add `-timestamp 2026-09-30T08:37:10Z -o /tmp/snowtime-then.db` to the restore command.

### Alternative: Turso Sync

Turso Sync (`@tursodatabase/sync`, with Drizzle's `drizzle-orm/tursodatabase-sync`) also
keeps the file on the server and all reads and writes local, and `push()` sends local
changes to a Turso Cloud database, which then serves as the backup. The app doesn't use it:
it replaces the libSQL engine with Turso's rewrite, which hasn't reached 1.0. A spike on
2026-09-30 (task 075) found:

- It runs under Bun 1.4.2. All migrations and the full seed apply through the Drizzle
  driver, with the same row counts and the same report results as libSQL.
- The engine doesn't enforce foreign keys unless each connection runs
  `PRAGMA foreign_keys = ON`; libSQL enforces them by default.
- It has no automatic push: the app would call `push()` after each write, for example
  from `sessionMiddleware`, or on a timer, and once more at shutdown. Push needs a Turso
  Cloud database, which the spike didn't reach.
- The same engine can't share the file with SQLite in another process (task 077): a
  migration or Litestream running beside it loses or can't read data. See the database
  drivers in `../architecture/platform.md`, "Environments and deployment".

## Measure the server

To size a server, run `perf:load` on it (`../../perf/README.md`). With a compiled release,
check out the repository at the release's commit, install Bun and the dependencies, and
run the release's executable on a copy of the benchmark database, on a free port beside the
live app:

```bash
bun install --frozen-lockfile
bun run perf:load --executable=/opt/snowtime/current/snowtime
```

The benchmark server runs with password sign-in and seeded users, on its own database copy
and port; it never touches the live database. It competes with the live app for CPU while
it runs, so run it before going live or at a quiet time.
