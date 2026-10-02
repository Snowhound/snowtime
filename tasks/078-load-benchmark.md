# 078: Load benchmark and capacity baseline

Status: in-progress (harness built and documented; local ramps under way, then Hetzner)

Find how many companies and users today's backend serves on a 1 vCPU, 2 GB server, what
fails first beyond that, and leave a repeatable harness that tasks 079 and 081 measure
their changes with. `perf:load` (task 075) times four pages for one user with 10 requests in
flight. It covers no other users, no writes, no database larger than memory, and no
overload, and its closed loop slows down with the server, which hides queueing.

## Local first, Hetzner to confirm

- **Local.** The release image, built for Arm64 because the x64 image from GHCR would run
  under emulation, runs in Docker with `--cpus=1 --memory=2g` and Caddy in front, as the
  Compose stack has it. The load generator runs on the Mac's other cores. Every scenario,
  every A/B comparison, and every push past the breaking point happens here.
- **Hetzner.** A few runs on the demo server (CX11: x64, 1 shared vCPU, 2 GB, 20 GB disk)
  give the only numbers that `README.md` and `docs/hosting.md` may quote. A run there stops
  at the knee and never pushes the server into failure.
- **Calibration.** One fixed-rate scenario runs in both places. The ratio of CPU per
  request lets later local runs predict the server, and shows where a local result doesn't
  carry over: disk, steal time, x64 against Arm64.

## Usage model

Capacity is quoted in active users, so the results publish what a user does. Kait agreed
to this starting point on 2026-10-02:

| An active user in the peak hour                       | Times |
| ----------------------------------------------------- | ----- |
| Opens the app (the server-rendered timer page)        | 1     |
| Returns to the tab after 30 s (stale queries refetch) | 10    |
| Starts, stops, or switches the timer                  | 3     |
| Edits an entry                                        | 2     |
| Opens Reports for a week (every 5th user)             | 0.2   |
| Opens a month or year report (every 20th user)        | 0.05  |
| Exports a month (every 100th user)                    | 0.01  |
| Signs in                                              | 0.1   |

An action is every request it causes, refetches included, recorded from the browser.

## Datasets

| Dataset | People | Companies | Entries (a year) | Database | Against 2 GB memory |
| ------- | ------ | --------- | ---------------- | -------- | ------------------- |
| S       | 23     | 3         | 21,000           | 17 MB    | Cached              |
| M       | 1,099  | 63        | 1.19 million     | 0.9 GB   | Cached              |
| L       | 5,442  | 303       | 5.95 million     | 4.7 GB   | Twice the memory    |

The counts are the generator's output on 2026-10-02 (`perf/README.md`, "Datasets").

S is today's benchmark (the demo seed and Lumen Works). M and L follow a long tail of
company sizes: most have 2 to 10 people, a few 50 to 200, and the largest 500, the
`membersPerOrganization` limit. People behave as in `src/db/seed-company.ts` (holidays,
vacations, part time, people joining and leaving), and a share of them have a timer running.

- The generator is deterministic, inserts in bulk through the migrated schema, and dates
  the data relative to the day of the run, because the release image runs on the real
  clock.
- A dataset reaches the server as a file copied into the bench volume while the app is
  stopped. The importer (`compose.import.yml`) reads from Turso, so it doesn't apply.
- Every seeded user has a session, so a run doesn't spend the server's CPU on thousands of
  password hashes before it starts. Sign-in still runs at its rate in the mix.

## Load generator

k6 with arrival-rate executors. They send at the planned rate however slowly the server
answers, so queueing and dropped requests show up, and k6 maps a host name to an IP
address. Scenarios live in `perf/stress/`.

- Requests replay what the browser sends. Start addresses a server function by a hash
  from the build (`/_serverFn/<sha256>`) and encodes its own request bodies, so the harness
  records each action's requests in Chrome per build and replays them with each virtual
  user's IDs. Requests keep the browser's `Sec-Fetch-Site`, by which Start's CSRF check
  accepts them: behind Caddy the app sees its own URL as `http`, so `Origin` alone never
  matches (recorded for task 081). They also send the user's Paraglide locale cookie, as a
  returning browser does; without it, a page answers a user whose language isn't English
  with a redirect.
- Each virtual user is a different seeded user. A request carries a client address of its
  own in `cf-connecting-ip`, and the bench Caddyfile trusts the load generator as a proxy,
  so Better Auth's per-address limits count users rather than one machine. `writesPerUser`
  stays as it is; the model writes far less.

## Measurements

Per request kind and per load step:

- Offered and completed requests per second.
- Latency p50, p95, and p99, in the client and on the server (Caddy's access log
  `duration`), so the network's share can be told apart.
- Errors by kind: 5xx, 429, refused or reset connections, and timeouts after 30 s. A run in
  which the generator drops iterations is invalid.
- Per container (app, Caddy, sampler), from cgroup v2: CPU time and throttling, memory now
  and at peak split into anonymous and page cache, disk reads and writes, and CPU, memory,
  and IO pressure (PSI). From the host: steal time, and the database and WAL sizes.
- Optionally, the JS heap against RSS in the app, from an endpoint that only an
  environment variable on the bench deployment enables. Task 081 needs to know what
  today's 400 MB is made of.

A sampler container reads these files each second and serves them as JSON behind basic
auth, through Caddy. It doesn't mount the Docker socket, which gives root on the host. It
reports its own CPU and memory, which must stay under 1% of a CPU and 40 MB. The same
container runs locally.

## Runs

1. Calibration: a fixed low rate on S, M, and L.
2. Ramp: steps of 2 minutes until a stop rule fires, then 10 minutes at the last good
   step. Capacity is the highest step held within the targets.
3. Overload, locally only: 2 and 4 times the knee for 5 minutes, then back down. Record
   what fails first (unbounded latency, 502s from Caddy, the kernel killing the app), how
   memory grows, and how long recovery takes.
4. Cheap settings, locally, as A/B runs: Bun's `--smol`, if the compiled binary accepts it;
   a container memory limit of 512 and 768 MB (does the app slow down or get killed?); and
   a cap on Caddy's connections to the app (does it answer 503 instead of queueing?). A fix
   beyond configuration becomes its own task.

Targets, server side, agreed on 2026-10-02: p95 under 300 ms for server
function calls, 1 s for page loads and password sign-in, and 3 s for a year report, with
under 0.1% errors. Sign-in moved from 300 ms to 1 s the same day: its password hash alone
held S under 5,000 users while every other request stayed far below its target. On
Hetzner, missing a target for 30 seconds, memory above 85% of 2 GB, or the disk above 80%
drops the load two steps and ends the ramp.

## Hetzner setup

- `deploy/compose/compose.bench.yml` adds the sampler, basic auth, the trusted load
  generator, and a bench volume in place of the demo's. The demo is offline during a run;
  deploying without the override brings it back.
- k6 maps `snowtime-internal.snowhound.eu` to the address in `BENCH_ORIGIN_IP`, an
  environment variable that is never committed. TLS and Caddy's certificate stay as they
  are, and Cloudflare is out of the path: its free plan can challenge one address sending
  thousands of requests, and its latency isn't the server's. UFW must let the generator
  reach port 443.
- The generator runs on the Mac. If home network noise shows in the client-side timings
  at low load, it moves to a temporary Hetzner VM in the same location.
- Kait starts and stops the bench stack and runs anything else on the server. The agent
  never connects to the server: it sends load to the origin and reads the sampler's URL
  with its password.

## Local results so far (2026-10-02)

Release image built for Arm64 from this branch, on one core of an M-series Mac with 1,792
MB for the app. Capacity is the highest step that held its targets for 10 minutes. Results
are in `perf/.cache/stress/runs/`.

| Dataset | Capacity              | Missed at                 | App CPU, memory at capacity                     | CPU per request |
| ------- | --------------------- | ------------------------- | ----------------------------------------------- | --------------- |
| S       | 8,000 (see the stall) | 12,500; 10,000 for 10 min | 43%, 362 MB                                     | 3.0 ms          |
| M       | 6,500                 | 8,000, by 41 ms           | 31%, 441 MB (peak 496)                          | 2.6 ms          |
| L       | 8,000                 | 10,000                    | 39%, 763 MB (peak 790; 461 MB of it page cache) | 2.7 ms          |

CPU per action on S, each action alone (`--run=kinds`): open 54 ms, return 25 ms, timer 27
ms, edit 26 ms, week report 19 ms, month report 41 ms, year report 68 ms, export 27 ms,
sign-in 107 ms. An active user costs about 0.46 s of app CPU per peak hour.

Findings:

- Password sign-in limited S below 5,000 users under the 300 ms target, while everything
  else stayed under 100 ms. Kait moved sign-in to the page target (1 s) on 2026-10-02.
- Below 50% CPU, a run can still miss: the app stalls for about 2 seconds, and every kind
  misses in that 30-second window. In S's 10-minute run at 8,000 users, 239 of 248 slow
  requests fell in one 2-second span. The cause is open: a long garbage collection, or
  Docker's VM on the Mac. `/api/bench/heap` (the sampler's heap and stall columns) is
  meant to tell.
- CPU per request follows the size of the user's company, not of the database: M and L
  cost less per request than S, whose users are mostly in Lumen Works (18 dense members,
  admins who see every entry).
- The database's size barely shows. L's 4.7 GB is twice the memory, but the requests read
  recent weeks: the app's page cache settled near 460 MB and disk reads under 1 MB/s. L
  held more users than M, so M's miss at 8,000 by 41 ms was noise in a 30-second window.
- Most of the app's memory isn't the JS heap. On M at 2,000 users, the heap used 53 MB
  and external buffers 36 MB, of 214 MB RSS. The rest is the runtime, SQLite's cache,
  and the allocator.
- Caddy's bench log kept every header and reached 1.3 GB in a day of local runs. It now
  keeps only what the sampler reads, about 700 bytes a request: 8,000 users write about 365
  MB an hour.
- The sampler costs 0.1 to 0.5% of a CPU, and 12 to 33 MB of its own memory. With the page
  cache from reading Caddy's log, its cgroup reaches 37 to 42 MB of its 40 MB limit; the
  kernel reclaims that cache.

Overload on M (`--run=overload --users=6500`), twice: Caddy with 192 MB, then with 512 MB.

- At 2 times the knee (13,000 users) the stack holds or nearly does: one run held its
  targets at 55% app CPU, the other missed by a few hundred milliseconds. So M's real
  limit lies between 6,500 and 13,000, and the stalls decide where.
- At 4 times (26,000 users), nothing fails fast. Requests queue in Caddy and the app for
  up to 200 s, while k6 gives up after 30 s and reconnects. Caddy fails first: its memory
  grows with the waiting requests and thousands of TLS connections until the kernel kills
  it, 6 times at 192 MB and 2 times at 512 MB. The app isn't killed, but peaks at 1.4 GB
  (heap 400 MB, RSS 1.2 GB), which with Caddy's 0.5 GB nearly fills a 2 GB server.
- Recovery: once the load is back at the knee and Caddy has restarted, p95 is back at 15 to
  30 ms within 60 to 90 seconds.
- On the server, Cloudflare pools connections to the origin, so Caddy sees far fewer than
  one per user. A run that bypasses Cloudflare, as the Hetzner run does, sees them all.

Cheap settings on M, each a 5-minute run at 6,500 users unless noted:

| Setting                                    | Result                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App memory 768 MB                          | No change: within targets, 2.7 ms CPU a request, peak 433 MB                                                                                                        |
| App memory 512 MB                          | No change: within targets, peak 445 MB with page cache, RSS 332 MB                                                                                                  |
| `--smol` (`BUN_OPTIONS`)                   | 3% less RSS (316 against 326 MB), same CPU; not worth it                                                                                                            |
| Caddy cap: 24 requests in flight, 1 s wait | Overload run: at 4 times the knee, 28% of requests get a quick 503, the rest p95 about 1 s; app peak 579 MB, Caddy 295 MB, no restarts; back within targets at once |

A memory limit doesn't slow the app at the knee, but under overload the app grew to 1.4 GB
without the cap, so a 512 MB limit would get it killed there. The cap keeps memory flat
instead. Its 2 times phase held its targets, as in the second plain overload run, so the
cap costs nothing below overload.

Open: the capacity ramps ran with Caddy limited to 192 MB, and Caddy sat at 192 to 201 MB,
most of it page cache from writing the bench log. Its 2 times phase missed with 192 MB and
held twice with 512 MB. Whether the tight limit caused some stalls is open; a ramp with
`--caddy-memory=512m` settles it.

The deploy workflow publishes the sampler image and copies the bench files, and
`docs/deployment/compose.md` ("Run the load benchmark") has the server steps.

## Acceptance criteria

- [x] Usage model and targets agreed with Kait as the starting point (2026-10-02)
- [x] A dataset generator for S, M, and L, documented in `perf/README.md`
- [x] `bun run perf:stress` runs a scenario on the local stack and prints a table per
      step, documented in `perf/README.md`
- [x] The sampler and `compose.bench.yml`, with the sampler's own cost measured
- [ ] Local results, with numbers: capacity on S, M, and L; the overload behavior; each
      cheap setting
- [ ] On Hetzner: calibration and a ramp on at least M, with no stop rule broken for longer
      than it took to drop the load
- [ ] `docs/hosting.md` sizing measured on the server, which closes task 075's server run.
      `README.md` states capacity with the date, the release, the dataset, and the usage
      model
- [ ] A baseline that tasks 079 and 081 reuse: CPU per request kind, RSS at idle and peak, and
      capacity per dataset

## Out of scope

Vercel and Turso, Cloudflare's caching, and the browser's side, which `perf:pages` covers.
