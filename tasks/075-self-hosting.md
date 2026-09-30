# 075: Self-hosting on one Linux server

Status: in-progress

Add a second way to deploy beside Vercel and Turso: one Linux server running the app,
built on the server or as a compiled Bun binary, with SQLite in the same process, Caddy in
front of it, and optionally Cloudflare proxying in front of Caddy. Any VM, dedicated
server, or machine on premises with systemd works; Hetzner Cloud is the worked example.
The goals are a fixed monthly cost, no Vercel Hobby non-commercial limit, data with a
provider of your choice, and faster pages. The Vercel path stays documented and working.

## Findings (2026-09-30)

Measured on an M1 Pro with the perf harness's seeded database (demo seed plus Lumen Works,
about 20,300 entries), signed in as the owner. Each run did 30 sequential requests per
page, then 8 seconds at 10 concurrent requests, all on loopback. The load generator shared
the machine, so read the numbers as ratios, not capacity.

| Page          | `sqld` over HTTP: p50 / CPU per request / req/s | In-process `file:`: p50 / CPU per request / req/s |
| ------------- | ----------------------------------------------- | ------------------------------------------------- |
| timer         | 41 ms / 91 ms / 39                              | 20 ms / 30 ms / 66                                |
| settings      | 19 ms / 22 ms / 62                              | 13 ms / 15 ms / 89                                |
| reports, week | 49 ms / 102 ms / 34                             | 15 ms / 17 ms / 80                                |
| reports, year | 122 ms / 196 ms / 12                            | 52 ms / 58 ms / 21                                |
| Memory (RSS)  | 300–515 MB app, up to 176 MB `sqld`             | 330–483 MB                                        |

- The database must run in the app's process. Going through `sqld` over HTTP makes pages
  2–3 times slower and uses 3–4 times the CPU, because every query is serialized to JSON
  and sent to a second process.
- Splitting the app (Vercel or Cloudflare) from the database (a server elsewhere) is ruled
  out. A page makes several database round trips, and each costs 10–30 ms across
  providers (`docs/deployment/vercel.md`, "Before you start").
- `bun build --compile` bundles `.output/server/index.mjs` into one binary: about 70 MB
  without bytecode, 101 MB with it. It includes the Bun runtime and the bundled JS, which
  JavaScriptCore still runs and JIT-compiles. The binary ran as fast as
  `bun .output/server/index.mjs`.
- Compiling needs two build steps:
  - `NITRO_PRESET=bun` for the build.
  - A `Bun.build` plugin for libSQL's native addon. `libsql/index.js` loads it with
    ``require(`@libsql/${target}`)``, which the bundler can't follow, and the binary then
    fails with `Cannot find module '@libsql/<target>'`. The plugin rewrites that line to a
    static `require('@libsql/linux-x64-gnu')` (or the build's target), and Bun then embeds
    the `.node` file. Tested on `darwin-arm64` and, cross-compiled from it, Linux Arm64.
- The binary doesn't include `.output/public` (36 MB, of which `backgrounds/` is 32 MB).
  Caddy serves it from disk instead. Nitro would serve these files through its JS handler,
  on the thread that renders pages; Bun's fast static routes (`Bun.serve` `static`) aren't
  used by Nitro.
- `--bytecode` and profile-guided bytecode layout (`--bytecode-order`,
  [Bun docs](https://bun.com/docs/bundler/executables#profile-guided-bytecode-layout))
  speed up startup, not requests. For a long-running server, that shortens the gap during
  a restart.
- Sizing: see "Measured" below and `docs/deployment/self-hosted.md` ("Server
  requirements"). The numbers from a real server are still to come.
- Run exactly one app process. Two processes writing one SQLite file bring back the
  lost-write problem in task 043. The in-memory rate-limit store is then correct, so
  Upstash isn't needed.

## Two ways to run the app

Both are tied to one platform, because the build includes only its own machine's libSQL
addon. A Mac build of `.output` has only `@libsql/darwin-arm64` in
`.output/server/node_modules`, so it won't run on Linux either. The two ways differ in
where the build happens:

- **Build on the server.** `bun install && bun run build:self-hosted`, then run
  `bun .output/server/index.mjs`. It works on any architecture the server has and needs
  no change to the app, but the server needs Bun.
- **Compiled binary.** `bun run build:binary` builds one release per architecture: the
  server and a migrator as executables, `drizzle/`, and `public/`. The server needs no
  runtime.

Everything else is shared: Caddy, systemd, backups, and migrations. Only the unit's
`ExecStart` and the place of the build differ. `docs/deployment/self-hosted.md` covers
both.

## Backups

Both options keep the SQLite file on the server as the primary, with all reads and writes
local. Litestream is implemented and documented; Turso Sync is documented as the
alternative after a spike. Switching the app's driver to Turso Sync is Kait's decision.

- **Litestream** 0.5 streams each change to S3-compatible storage (Hetzner Object
  Storage, Cloudflare R2, and others), with point-in-time restore. It needs no code change
  and keeps libSQL.
- **Turso Sync** (`@tursodatabase/sync` 0.8.1 with `drizzle-orm/tursodatabase-sync`),
  spike on 2026-09-30 under Bun 1.4.2 on darwin-arm64, local only:
  - It runs under Bun. All 19 migrations and the demo plus company seed apply through the
    Drizzle driver, with equal row counts in all 14 tables, and the 12-month report's
    totals and bytes match libSQL's.
  - The engine stores table SQL reformatted (whitespace only), which nothing in the app
    reads.
  - It doesn't enforce foreign keys unless each connection runs
    `PRAGMA foreign_keys = ON`; libSQL enforces them by default. A switch must set it.
  - `push()` without a Turso Cloud URL fails with "sync is disabled as database was
    opened without sync support". There is no automatic push: the app would call it
    after each write (for example from `sessionMiddleware` after a POST, debounced), on a
    timer, and at shutdown. Push to Turso Cloud wasn't tested, since it needs an account.
  - It swaps libSQL for Turso's pre-1.0 engine, whose project advises independent
    backups until 1.0.

## Measured (2026-09-30)

`perf:load` (`perf/load.ts`) on an M1 Pro with the Lumen Works seed. "Docker" is a Linux
Arm64 VM limited to 2 CPUs. p50 and CPU per request are from the 30 sequential requests;
the last two columns from 8 seconds at 10 concurrent.

| Server                           | Page     | p50   | CPU/req | req/s at 10 | CPU/req at 10 |
| -------------------------------- | -------- | ----- | ------- | ----------- | ------------- |
| Bun on macOS                     | timer    | 20 ms | 32 ms   | 60          | 20 ms         |
|                                  | settings | 14 ms | 15 ms   | 79          | 14 ms         |
|                                  | week     | 16 ms | 17 ms   | 79          | 15 ms         |
|                                  | 9 months | 94 ms | 73 ms   | 20          | 52 ms         |
| Compiled, Docker (Debian)        | timer    | 30 ms | 43 ms   | 42          | 27 ms         |
|                                  | settings | 31 ms | 31 ms   | 61          | 17 ms         |
|                                  | week     | 21 ms | 23 ms   | 49          | 21 ms         |
|                                  | 9 months | 76 ms | 85 ms   | 12          | 92 ms         |
| `bun index.mjs`, Docker (Debian) | timer    | 31 ms | 48 ms   | 44          | 26 ms         |
|                                  | settings | 25 ms | 26 ms   | 59          | 18 ms         |
|                                  | week     | 25 ms | 27 ms   | 46          | 22 ms         |
|                                  | 9 months | 75 ms | 85 ms   | 12          | 86 ms         |
| `bun index.mjs`, Docker (Alpine) | timer    | 30 ms | 44 ms   | 41          | 29 ms         |
|                                  | 9 months | 71 ms | 82 ms   | 15          | 71 ms         |

- Peak RSS: 454 MB on macOS; 383 MB compiled and 394 MB with Bun in Docker; 406 MB on
  Alpine. The compiled server uses 82 MB once it listens and 91 MB after the first page.
- Sizes: the server executable is 101 MB (Arm64) and 102 MB (x64) with bytecode, the
  migrator 90 MB, and `public/` 36 MB. Precompression turns 2.9 MB of text files into
  1.4 MB of brotli.
- Profile-guided bytecode layout needs Bun 1.4.3 (a canary on 2026-09-30); 1.4.2 accepts
  `--bytecode-order` but writes no profile. In Docker, over 15 and 25 alternating starts:
  ready in 102 vs 110 ms and 117 vs 128 ms, first page at 126 vs 128 ms and 138 vs 149 ms,
  and 82 MB ready and 91 MB after the first page either way. It saves about 10 ms and no
  memory, so it isn't kept.
- Database size: 640 bytes per time entry with indexes (13.5 MB for 20,942 entries).
- Caddy in front, locally: the 9-month report page is 719 KB of HTML, sent as 36 KB with
  zstd and 40 KB with gzip. The largest script, 175 KB, goes out as its 50 KB `.br` file.
  During an app restart, a request waited 2.2 s and got a 200.

## Acceptance criteria

- [x] A build script (for example `bun run build:binary`) produces one Linux binary for
      x64 and Arm64, with `--bytecode`, from the Nitro `bun` preset and the libSQL plugin.
      It fails with a clear message when the target's `@libsql/<target>` package is
      missing. `bun install --os=linux --cpu=<arch>` adds that package beside the host's.
- [x] Profile-guided bytecode layout is tried. Keep it only if startup time or startup
      memory drops measurably, with the numbers recorded here. Not kept (see "Measured").
- [x] Behind Cloudflare, Better Auth and the rate limits see the user's IP address:
      `advanced.ipAddress.ipAddressHeaders` reads `cf-connecting-ip`, and Caddy accepts
      that header only from Cloudflare's IP ranges (`trusted_proxies`). Set through
      `CLIENT_IP_HEADER`, which stays unset on Vercel. Tested with loopback standing in for
      Cloudflare, not yet behind the real proxy.
- [x] A Caddyfile in the repository (`deploy/self-hosted/Caddyfile`, Caddy 2.11 or later,
      tested with 2.11.4):
  - serves `.output/public` from disk, `/assets/*` as `immutable` and `/backgrounds/*`
    and `/brand/*` for a week, matching `vite.config.ts`
  - serves files precompressed at build time (`file_server { precompressed br zstd gzip }`;
    brotli first, because it came out about 6% smaller than zstd)
  - proxies everything else to the app, compressing its HTML and JSON with
    `encode zstd gzip` above about 1 KB; the report export sends up to 755 KB per piece.
    Stock Caddy can't compress to brotli on the fly, only serve precompressed `.br` files
  - serves HTTP/1.1, HTTP/2, and HTTP/3 (`protocols h1 h2 h3`, UDP 443 open). Behind
    Cloudflare, HTTP/3 reaches only Cloudflare, which connects to the origin over HTTP/1.1
    or HTTP/2, so origin HTTP/3 matters only when the domain isn't proxied
  - holds requests during an app restart (`lb_try_duration`) instead of returning 502
  - sets security headers as minupatsient's Caddyfile does (HSTS, `nosniff`, frame and
    referrer policy, no `Server` header), with a Content Security Policy checked against
    the inline scripts that server rendering adds. Pages keep the app's nonce policy, and
    Caddy adds a strict one only to responses without one. Every script tag on the timer,
    settings, and reports pages carries the nonce, and Chrome logged no violations
  - redirects HTTP to HTTPS and logs as JSON
- [x] Both ways to run the app work from the same Caddyfile and unit, with only
      `ExecStart` changed. Tested on Debian 13 under systemd in Docker, not yet on a real
      server.
- [x] A hardened systemd unit runs the app as an unprivileged user, restarts it on
      failure, and reads secrets from an environment file. No Docker.
      `systemd-analyze security` rates it 1.5 ("OK").
- [x] Backups work with Litestream, and a restore onto a fresh server is tested and
      written down. Tested in Docker with adobe/s3mock as the bucket, including a
      point-in-time restore; not yet with Hetzner Object Storage or R2.
- [x] Migrations run against the local file on deploy (`bun run db:migrate` with a `file:`
      URL, or the release's `snowtime-migrate`), before the app restarts.
- [ ] The perf load script is committed under `perf/` and run on the real server. The
      measured numbers replace the rough sizing above. Committed as `bun run perf:load`;
      not yet run on a real server.
- [x] `docs/deployment/self-hosted.md` has a "Server requirements" section: OS, CPU and
      memory, disk with the database's growth, network, software, and region, with
      Hetzner as the example that meets them.
- [x] Docs:
  - `docs/deployment.md` splits into one runbook per target, `docs/deployment/vercel.md`
    and `docs/deployment/self-hosted.md`, with an index (`docs/deployment/README.md`)
    that compares them. The self-hosted runbook covers building on the server and the
    compiled binary.
  - `README.md` links the index.
  - `docs/hosting.md` gains the self-hosted constraints (single process, backups, server
    size).
  - `docs/architecture/platform.md` no longer names Vercel as the only adapter.
- [x] A CI deploy job for the self-hosted target, or a documented manual deploy. Manual,
      in the runbook.
- [ ] If Snowhound's production moves, the privacy page names the server's provider (and
      Cloudflare, and the backup storage) instead of Vercel, Turso, and Upstash. Waits on
      Kait's decision to move.

## Still to test on a real server

- `perf:load` on the server, to replace the sizing in `docs/hosting.md` and the runbook.
- Let's Encrypt behind Cloudflare: the first certificate with the record set to DNS only,
  then renewal with the proxy on and SSL mode Full (strict).
- Client IPs through Cloudflare's real proxy, and HTTP/3 with the proxy off.
- Litestream against Hetzner Object Storage or R2, and a restore from it.
- Building on a 4 GB server: memory during `vite build`.
- Ubuntu 24.04 and x64: the tests ran on Debian 13 Arm64 only.

## Decisions (2026-09-30)

- Snowhound's production stays on Vercel and Turso. Self-hosting is an option this open
  source project offers, not a planned move, so task 043 doesn't block this task. The
  self-hosted runbook and `docs/hosting.md` name task 043 as a known risk until it's fixed.
- A week of point-in-time restore (`retention: 168h` in `litestream.yml`) is enough.
- 4 GB is expected to be enough for building on the server; Kait will confirm it on a real
  server later, with the other checks above.
