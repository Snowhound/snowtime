# 075: Self-hosting on one Hetzner box

Status: todo

Add a second way to deploy beside Vercel and Turso: one Hetzner VM running the app, built
on the box or as a compiled Bun binary, with SQLite in the same process, Caddy in front of it, and Cloudflare
proxying in front of Caddy. The goals are a fixed monthly cost, no Vercel Hobby
non-commercial limit, data with an EU provider, and faster pages. The Vercel path stays
documented and working.

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
- Splitting the app (Vercel or Cloudflare) from the database (Hetzner) is ruled out. A page
  makes several database round trips, and each costs 10–30 ms across providers
  (`docs/deployment.md`, "Before you start").
- `bun build --compile` bundles `.output/server/index.mjs` into one binary of about
  70 MB. It includes the Bun runtime and the bundled JS, which JavaScriptCore still runs
  and JIT-compiles. The binary ran as fast as `bun .output/server/index.mjs`.
- Compiling needs two build steps:
  - `NITRO_PRESET=bun` for the build.
  - A `Bun.build` plugin for libSQL's native addon. `libsql/index.js` loads it with
    ``require(`@libsql/${target}`)``, which the bundler can't follow, and the binary then
    fails with `Cannot find module '@libsql/<target>'`. The plugin rewrites that line to a
    static `require('@libsql/linux-x64-gnu')` (or the build's target), and Bun then embeds
    the `.node` file. Tested on `darwin-arm64` only.
- The binary doesn't include `.output/public` (36 MB, of which `backgrounds/` is 32 MB).
  Caddy serves it from disk instead. Nitro would serve these files through its JS handler,
  on the thread that renders pages; Bun's fast static routes (`Bun.serve` `static`) aren't
  used by Nitro.
- `--bytecode` and profile-guided bytecode layout (`--bytecode-order`,
  [Bun docs](https://bun.com/docs/bundler/executables#profile-guided-bytecode-layout))
  speed up startup, not requests. For a long-running server, that shortens the gap during
  a restart.
- Sizing, rough: an ordinary page costs 15–30 ms of CPU and a year report about 55 ms. One
  process is single-threaded and reached 66–89 page renders/s on the M1 Pro. A shared
  Hetzner vCPU is probably 1.5–2 times slower. The smallest 2 vCPU / 4 GB plan (CX or CAX
  class) should fit: one core for the app, one for Caddy, the backup process, and the OS.
- Run exactly one app process. Two processes writing one SQLite file bring back the
  lost-write problem in task 043. The in-memory rate-limit store is then correct, so
  Upstash isn't needed.

## Two ways to run the app

Both are tied to one platform, because the build includes only its own machine's libSQL
addon. A Mac build of `.output` has only `@libsql/darwin-arm64` in
`.output/server/node_modules`, so it won't run on Linux either. The two ways differ in
where the build happens:

- **Build on the server.** `bun install && bun run build`, then run
  `bun .output/server/index.mjs` (or `node` with Nitro's default `node-server` preset). It
  works on any architecture the box has and needs no change to the app, but the box needs
  Bun or Node.
- **Compiled binary.** CI builds one binary per architecture and copies it with
  `.output/public`. The box needs no runtime. It adds the build plugin and one build per
  target.

Everything else is shared: Caddy, systemd, backups, and migrations. Only the unit's
`ExecStart` and the place of the build differ.

## Backups: two options

Both keep the SQLite file on the box as the primary, with all reads and writes local.

- **Litestream.** Streams the WAL to Hetzner Object Storage or Cloudflare R2, with
  point-in-time restore. It needs no code change and keeps libSQL.
- **Turso Sync.** `@tursodatabase/sync` with Drizzle's `drizzle-orm/tursodatabase-sync`
  driver: a local file, with `push()` sending local changes to a Turso Cloud database and
  `pull()` fetching remote ones ([docs](https://docs.turso.tech/sync/usage)). The Turso
  Cloud copy then serves as the backup and can be queried there. The costs:
  - It swaps the database engine from libSQL to Turso's Rust rewrite, which hasn't reached
    1.0; the Turso project advises keeping independent backups until then.
  - The app must call `push()` itself, after writes or on a timer.
  - Bun support and the rewrite's SQLite compatibility with our schema and migrations are
    unverified.

Pick one in this task after trying both on the seeded database. Document both either way.

## Acceptance criteria

- [ ] A build script (for example `bun run build:binary`) produces one Linux binary for
      x64 and Arm64, with `--bytecode`, from the Nitro `bun` preset and the libSQL plugin.
      It fails with a clear message when the target's `@libsql/<target>` package is
      missing.
- [ ] Profile-guided bytecode layout is tried. Keep it only if startup time or startup
      memory drops measurably, with the numbers recorded here.
- [ ] Behind Cloudflare, Better Auth and the rate limits see the user's IP address:
      `advanced.ipAddress.ipAddressHeaders` reads `cf-connecting-ip`, and Caddy accepts
      that header only from Cloudflare's IP ranges (`trusted_proxies`).
- [ ] A Caddyfile in the repository:
  - serves `.output/public` from disk, `/assets/*` as `immutable` and `/backgrounds/*`
    and `/brand/*` for a week, matching `vite.config.ts`
  - serves files precompressed at build time (`file_server { precompressed zstd br gzip }`)
  - proxies everything else to the app, compressing its HTML and JSON with
    `encode zstd gzip` above about 1 KB; the report export sends up to 755 KB per piece.
    Stock Caddy can't compress to brotli on the fly, only serve precompressed `.br` files
  - serves HTTP/1.1, HTTP/2, and HTTP/3 (`protocols h1 h2 h3`, UDP 443 open). Behind
    Cloudflare, HTTP/3 reaches only Cloudflare, which connects to the origin over HTTP/1.1
    or HTTP/2, so origin HTTP/3 matters only when the domain isn't proxied
  - holds requests during an app restart (`lb_try_duration`) instead of returning 502
  - sets security headers as minupatsient's Caddyfile does (HSTS, `nosniff`, frame and
    referrer policy, no `Server` header), with a Content Security Policy checked against
    the inline scripts that server rendering adds
  - redirects HTTP to HTTPS and logs as JSON
- [ ] Both ways to run the app work on the box from the same Caddyfile and unit, with only
      `ExecStart` changed.
- [ ] A hardened systemd unit runs the app as an unprivileged user, restarts it on
      failure, and reads secrets from an environment file. No Docker.
- [ ] Backups work with the chosen option, and a restore onto a fresh box is tested and
      written down.
- [ ] Migrations run against the local file on deploy (`bun run db:migrate` with a `file:`
      URL), before the app restarts.
- [ ] The perf load script is committed under `perf/` and run on the real box. The measured
      numbers replace the rough sizing above.
- [ ] Docs:
  - `docs/deployment.md` splits into one runbook per target, `docs/deployment/vercel.md`
    and `docs/deployment/hetzner.md`, with an index that compares them. The Hetzner
    runbook covers building on the server and the compiled binary.
  - `README.md` links the index.
  - `docs/hosting.md` gains the self-hosted constraints (single process, backups, box
    size).
  - `docs/architecture.md` no longer names Vercel as the only adapter.
- [ ] A CI deploy job for the Hetzner target, or a documented manual deploy.
- [ ] If Snowhound's production moves, the privacy page names Hetzner (and Cloudflare, and
      the backup storage) instead of Vercel, Turso, and Upstash.

## Progress (2026-09-30, handover notes)

Done:

- `4c47ab3`: `CLIENT_IP_HEADER` in `src/env.ts` and `.env.example`; Better Auth reads the
  client IP from that header (`advanced.ipAddress.ipAddressHeaders`). Unset keeps
  `x-forwarded-for`, which Vercel sets. Better Auth is the only code that derives an IP
  (rate limits and `session.ip_address`); without a single trustworthy value it counts
  every request under one `no-trusted-ip` key.
- `4e8bbf9`, `d69772f`: `scripts/build-self-hosted.ts` (`build:self-hosted`,
  `build:binary`), `scripts/db-migrate-release.ts` (the compiled migrator), and
  `db-verify.ts` exporting `verifyMigrations`. Linux libSQL addons come from
  `bun install --os=linux --cpu=<arch>`, which adds them beside the host's.
- `ff33378`: `perf/load.ts` (`perf:load`), documented in `perf/README.md`.

Next: Caddyfile, systemd unit, Litestream, Turso Sync spike, docs split
(`docs/deployment/self-hosted.md`, provider-neutral with Hetzner as the example).

Measured so far (M1 Pro; Docker = Linux arm64 VM limited to 2 CPUs and 4 GB):

- Binary sizes: server 101 MB (arm64) and 102 MB (x64) with bytecode; migrator 90 MB.
- `perf:load`, Docker, Linux binary vs `bun .output/server/index.mjs`: equal within noise.
  Binary p50 timer 30 ms, settings 31 ms, week 21 ms, year 76 ms; CPU per request 17–27 ms
  for ordinary pages and 85–92 ms for the year; peak RSS 383 MB (Bun: 394 MB).
- Bytecode order (Bun 1.4.3 canary; 1.4.2 lacks it), 15 and 25 alternating starts:
  ready 102 vs 110 ms and 117 vs 128 ms, first page 126 vs 128 ms and 138 vs 149 ms,
  RSS 82 MB ready and 91 MB after the first page either way. Not kept.

Decisions:

- A compiled `snowtime-migrate` ships with the binary, so a server without Bun still runs
  `db:verify` and the migrations. drizzle-orm's migrator writes the same
  `__drizzle_migrations` rows and schema as `drizzle-kit migrate` (checked by hash).

Open questions for Kait:

- Task 043 now applies to production: the self-hosted app uses a `file:` URL, where a
  `SQLITE_BUSY` inside one process can lose later writes. Litestream's checkpoints take the
  write lock briefly too.
