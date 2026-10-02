# 078: Load benchmark and capacity baseline

Status: todo

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
| S       | 19     | 2         | 20,000           | 14 MB    | Cached              |
| M       | ~1,000 | ~60       | ~1.1 million     | ~0.7 GB  | Cached              |
| L       | ~6,000 | ~300      | ~6.6 million     | ~4.2 GB  | Twice the memory    |

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
  user's IDs. Requests send `Origin`, which Start's CSRF middleware checks.
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
function calls, 1 s for page loads, and 3 s for a year report, with under 0.1% errors. On
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

## Acceptance criteria

- [x] Usage model and targets agreed with Kait as the starting point (2026-10-02)
- [ ] A dataset generator for S, M, and L, documented in `perf/README.md`
- [ ] `bun run perf:stress` runs a scenario on the local stack and prints a table per
      step, documented in `perf/README.md`
- [ ] The sampler and `compose.bench.yml`, with the sampler's own cost measured
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
