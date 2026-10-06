# Whole-server scaling runs

Run from the repository root. Build images and generate both datasets before measuring.
Task [081.10](../../../tasks/081-native-backend/10-load-and-scaling.md) records results.
The shared stress guard serializes local runs across worktrees. Leave the Mac idle.

```sh
bun native/bench/scaling/run.ts --app=native --dataset=M --cores=1 --memory=1536m \
  --readers=0 --from=10000 --fixed=5000,10000
```

Use a fresh replica for every restored run. The local harness waits for its initial
replication, warms with writes, and waits for the initial level-two compaction
before measuring. Ramps use their normal warmup; other replicated runs warm for
30 seconds at 500 users. Remote startup readiness is the operator's responsibility.
The gate does not wait for the hourly level-three compaction. Its first full-database
copy can overlap a later step. Record compaction UTC times, label affected steps as
startup-affected, and retain that caveat when comparing held offers across modes.

Every cell starts with a ramp and holds the last passing step. Fixed loads are optional
and must fit that hold. Default steps last 60 seconds; holds and fixed loads last 120.
Set `--readers=auto` to repeat with the pool, `--no-replication` for the matched
replication control, and `--app=ts` for one Bun process behind Caddy. Reuse the same
page-inclusive recording and source database files in all comparisons. The native
edge serves TLS directly; its Caddy container only exposes instrumentation.

For 2, 4, and 8 cores, the app uses `0-1`, `0-3`, and `0-7`; k6 gets the remaining
VM cores. Core 1 serves the one-core app and k6 gets `2-9`. Caddy, Litestream, and the
sampler share the app's assigned cores. The app's memory flag excludes the proxy,
replication, and operating system. Reserve 384 MiB for the OS and 256 MiB for
TypeScript's Caddy. Replication defaults to 128 MiB for M and 512 MiB
for L, after smaller L limits caused OOM kills. Fresh L startup passes at 512 MiB
with 72 MB of observed process swap and 198 MB of peak cgroup swap; this is not a
swap-free budget. For a 2-GiB M target this leaves
1,536 MiB for native or 1,280 MiB for TypeScript. L leaves 1,152 or 896 MiB.
Override replication with `--litestream-memory=512m` (MiB, optional `m` suffix). The
runner computes these app limits when `--memory`
is omitted. Scale the total target to 4, 8, and 16 GiB at 2, 4, and 8 cores. The
benchmark-only sampler is reported separately.

Reject any dropped actions or generator-limited run. The local harness stops when k6
uses over 70% of its assigned-core budget. Preserve `capacity.json`, per-step summaries,
requests, samples, settings, images, and service logs. A queue rejection is a deliberate
503, not a passing latency/capacity result. Review the generator's memory and virtual
users too; CPU headroom alone does not validate a dropped-action run.

## Serial local matrix

```sh
bun native/bench/scaling/matrix.ts --phase=single --dataset-date=2026-10-05 \
  --litestream-image=litestream/litestream:0.5.15
bun native/bench/scaling/matrix.ts --phase=pool --dataset-date=2026-10-05 \
  --litestream-image=litestream/litestream:0.5.15
```

Run the phases sequentially. Task 081 uses tested 0.5.15 for the resumed matrix; the
scaling drivers default to 0.5.15. The underlying stress harness and production pin
remain 0.5.0. Record the selected image explicitly. The driver measures M, then L, at 1,
2, 4, and 8 guest
cores. It retries a failed first ramp step at a lower offer and saves each attempt.
A generator-limited size stops without claiming app capacity. One-core cells also
run matched fixed offers at 1k and 5k users and isolated request kinds. A fixed offer
can miss app targets; its result does not establish capacity. The separate 40k controls
recorded in task 081 compare no replication, 0.5.0,
and 0.5.15; the matrix does not repeat them.
Use `--cores=1,2` to restrict the sizes and `--datasets=M` to repeat one dataset.
The matrix summary replaces that cell's latest decision and preserves other cells;
raw folders retain every attempt.

`--dataset-date` selects the single preserved database/users pair for that date. It
refuses ambiguous pairs and missing older seeds. Record input SHA-256 hashes beside
the matrix. Pin the same date for every invocation so midnight does not replace the
source dataset. Sessions must still be valid; regenerate and repeat matched baselines
when an old seed expires. Source data remains unchanged by load because each invocation
restores a copy in the benchmark volume.

## Focused prepared-server comparison

Use this when startup has already been measured and the question is sustained pool
benefit. Task 081's focused protocol measures one/eight-core endpoints; intermediate
pool sizes are deferred. It retains one live database and replica per dataset, so
benchmark writes accumulate and the OS page cache remains warm. Each invocation
recreates app/proxy/sampler; Litestream stays running with updated CPU affinity. Compare
its paired single/pool rows with each other; earlier
fresh-source capacities remain separate evidence.

```sh
# Continue the prepared L stack, including a TypeScript eight-core comparison.
bun native/bench/scaling/focused.ts --dataset=L --prepared --typescript
# After verifying L restore, start M from the pinned source once.
bun native/bench/scaling/focused.ts --dataset=M
```

The driver preserves `081-focused-matrix.json`, starts ramps near known passing
loads, retains the normal step/hold durations and generator checks, and runs the
one-core fixed offers and isolated kinds in both native modes. `--no-load` keeps
replication metadata and the running replication process, checking its mount, image,
and memory limit. It skips initial-snapshot
gates because there is no source restore. Record source hashes, live table counts,
session freshness, and UTC bounds; keep fresh startup tests separate. Do not run
this driver alongside the full matrix or another stress invocation.

After a pause, restart the retained app/replication stack without restoring its database,
then add `--prepared --resume`. Resume keeps completed ramp decisions, fixed validity
files, and fully collected eleven-group kind runs. An interrupted run remains raw
evidence and is repeated; it is not claimed as capacity.

## Two-machine repeat on Hetzner

Kait provisions a dedicated-CPU app server and a separate k6 machine on the same
private network. This script provisions nothing. Copy this checkout, the source M/L
databases, users, and recording to the appropriate machines. Use
[`perf/README.md`](../../../perf/README.md)'s remote stack setup and credentials.

Deploy each app-server cell with its assigned core and total memory budget. Configure
`DB_READ_CONNECTIONS`, `SCRYPT_CONCURRENCY`, and `WORK_QUEUE_TIMEOUT_MS` in the native
container. Builds before task 081.17 also take `DB_CONCURRENCY` (readers plus two); later
ones size the database gates from the connections. Keep one Bun process for TypeScript.
Stop app and Litestream before restoring the source dataset and clearing only the
benchmark database's replication metadata. Use a fresh replica directory per cell,
then wait for replication to reach steady state before offering load.

For native, configure the app's own TLS listener on the public benchmark origin and
provide a certificate through the host's existing TLS configuration. Remove Caddy
from the application request path. For TypeScript, keep Caddy on that origin. Keep
sampler access separate from the app edge: an SSH tunnel to the server's loopback
sampler port works with `--sampler-url=http://127.0.0.1:19100`. The remote origin can
stay reachable through `BENCH_ORIGIN_IP` while the sampler uses that tunnel.

Use these reservations for each cell. App limits exclude 384 MiB for the OS,
128 MiB (M) or 512 MiB (L) for Litestream, and 256 MiB for TypeScript's Caddy.
The sampler's 40-MiB reservation is benchmark instrumentation outside the product
budget. Native needs no Caddy in its request path.

| Cores / total GiB | Native M MiB | Bun M MiB | Native L MiB | Bun L MiB |
| ----------------- | -----------: | --------: | -----------: | --------: |
| 1 / 2             |        1,536 |     1,280 |        1,152 |       896 |
| 2 / 4             |        3,584 |     3,328 |        3,200 |     2,944 |
| 4 / 8             |        7,680 |     7,424 |        7,296 |     7,040 |
| 8 / 16            |       15,872 |    15,616 |       15,488 |    15,232 |

On the app machine, before starting load:

1. Build the render bundle and release images for that machine's architecture before
   measuring. Build native with `CARGO_FEATURES=bench`; record the commit, image IDs,
   `uname -a`, CPU model, core affinity, RAM, swap limit, and SQLite page size. Use
   `litestream/litestream:0.5.15` for this repeat. Keep production's 0.5.0 pin.
2. Prepare a dedicated benchmark Compose project using `compose.yml`,
   `compose.bench.yml`, and a cell override with the images, cpusets, memory limits,
   sampler loopback port, and TLS settings. The local overrides hard-code the local
   origin and certificate, so adapt their settings rather than deploying them unchanged.
   Native mounts its render assets, migrations, certificate/key, and the shared bench
   log volume; set `EDGE_BENCH_LOG=/var/log/caddy/access.log` and `EDGE_COMPRESSION=true`.
   Set the native health check to HTTPS when its listener serves TLS. The sampler uses
   `APP_URL=''` for native and `http://app:3000` for Bun, and
   `LITESTREAM_URL=http://litestream:9090` for either backend.
3. Set `BENCH_AUTH_SECRET` to the same value on both machines. Trust only the generator's
   address for `CF-Connecting-IP`, as `compose.bench.yml` does. Set `DEMO_MODE=true` for
   seeded email sign-in. Restrict the native benchmark listener to the generator's
   address; its forwarded-address trust depends on that network boundary.
   Native uses `BETTER_AUTH_URL=https://<benchmark-host>`,
   `CLIENT_IP_HEADER=cf-connecting-ip`, `EDGE_HEADERS=true`, and its TLS listener on
   the benchmark origin. Caddy serves that origin for Bun.
4. Use app cores `0` for one core or `0-<cores-minus-one>` otherwise. Put Litestream,
   Caddy, and the sampler on the same cores. Set app and Caddy memory from the table;
   set app memory-plus-swap equal to app memory, matching the local matrix. Record
   replication/proxy swap limits explicitly; the local defaults allow up to twice
   their RAM limit. Native uses `DB_READ_CONNECTIONS=0` then `auto`,
   `SCRYPT_CONCURRENCY=<cores>`, and `WORK_QUEUE_TIMEOUT_MS=1000`, plus
   `DB_CONCURRENCY=<readers-plus-two>` for builds before task 081.17. Keep one Bun process.
5. Stop app and Litestream. Copy the pinned source into only the benchmark data volume,
   remove its old `snowtime.db-wal`, `snowtime.db-shm`, and `.snowtime.db-litestream`,
   and select a new replica directory. Record hashes of the DB, users, and recording
   on both machines. Never remove the preserved source or earlier raw/replica folders.
6. Start the cell. Wait for the initial snapshot, offer an unmeasured 500-user write
   warmup for 30 seconds, then wait for the initial level-two compaction starting at
   transaction one. Check `OOMKilled`, swap, and replication logs. Remote mode does
   not perform this restore or startup gate. Repeat steps 5–6 before every ramp,
   fixed offer, and request-kind invocation.
7. Expose sampler port 9100 only on server loopback, then run
   `ssh -N -L 19100:127.0.0.1:19100 <app-machine>` from the generator machine if the
   server maps loopback 19100 to sampler 9100. Verify the tunnel with
   `curl --fail http://127.0.0.1:19100/_bench/samples`. Record startup separately from
   measured load and preserve service logs before replacing a cell.

Keep source sessions valid throughout the repeat. Record UTC boundaries, rendered-page
date/time zone, and whether sessions are renewal-eligible. For a direct pool comparison,
use the same session-age condition for both modes; the pinned date flag alone does not
freeze the clock. If the old seeds expire, create new matched sources and repeat both
baselines rather than comparing against expired sessions.

On the generator machine:

```sh
# The four BENCH_* credentials/addresses are as perf/README.md documents.
bun native/bench/scaling/run.ts --remote --app=native --dataset=M --cores=4 \
  --memory=7680m --readers=0 --sampler-url=http://127.0.0.1:19100 --from=10000
```

After the ramp, restore again and run matched fixed and isolated-kind measurements:

```sh
bun perf/stress/stress.ts --remote --app=native --direct --dataset=M \
  --dataset-date=2026-10-05 --recording=perf/.cache/stress/slice-pages.json \
  --encoding=gzip --read-connections=0 --sampler-url=http://127.0.0.1:19100 \
  --run=fixed --users=5000 --seconds=120 --label=hetzner-native-single-4c-fixed5000
# Restore and complete the startup gate again before this invocation.
bun perf/stress/stress.ts --remote --app=native --direct --dataset=M \
  --dataset-date=2026-10-05 --recording=perf/.cache/stress/slice-pages.json \
  --encoding=gzip --read-connections=0 --sampler-url=http://127.0.0.1:19100 \
  --run=kinds --users=2 --seconds=30 --label=hetzner-native-single-4c-kinds
```

Repeat fixed offers at 1k and 5k for the one-core cells even when an offer misses the
app's target; label such results as overloads. Use `--dataset=L --from=1000` for L
ramps. Repeat native with `--readers=auto` in the cell driver and
`--read-connections=auto` in direct harness invocations, after changing the server's
actual `DB_READ_CONNECTIONS`. For Bun use `--app=ts` and omit `--direct`. These remote
flags record the intended mode; they do not configure the server.

`--remote` leaves deployment and resource limits to the app-server configuration;
local CPU/memory flags only record the intended cell. The app-server sampler cannot
see a separate machine's k6. Record the generator container's CPU and RSS independently,
with one-second `docker stats` or cgroup counters and its assigned core count. For
example, start `docker stats --no-trunc --format '{{json .}}' > generator-stats.jsonl`
before the driver, and save UTC start/end times beside it. Remote mode gives k6 all
available generator CPUs; it does not apply the local `--k6-cpuset` flag. Record its
actual cpuset and memory limit with `docker inspect` while it runs. Stop
when it loses substantial headroom or drops actions. Preserve both machines' counters
with the raw folder. This remote protocol requires Kait's server, TLS, and tunnel
setup and has not run in this task; local matrix results do not validate that setup.

## Proxy memory redistribution

The first M TypeScript overload on one core saturates the shared CPU, then
fills Caddy's 256-MiB budget and swaps heavily. Preserve that baseline. To
measure a 512-MiB proxy within the same whole-host target, run:

```sh
bun native/bench/scaling/run.ts --app=ts --dataset=M --cores=1 --readers=0 \
  --dataset-date=2026-10-05 --caddy-memory=512m --from=10000 \
  --litestream-image=litestream/litestream:0.5.15 \
  --label=081-caddy512-ts-single-1c
```

The runner deducts the larger proxy reservation from the app, leaving
1,024 MiB at the 2-GiB M target. This tuning result does not replace the
original 256-MiB allocation silently. Check CPU saturation, swap, queue
recovery, and app OOM state before choosing a memory split.

## Replication startup memory

Use `replication-memory.ts --out=<raw-folder>` to monitor an existing local
Litestream startup under the shared guard. The folder must contain `settings.json`
with a Unix-seconds `started` field. It records process high-water RSS, swap, memory
pressure, OOM state, logs, and sampler data. It stops Litestream when the initial
level-two compaction completes or the deadline expires. A resumed startup is a
component diagnostic; validate the chosen budget with a fresh source and replica
before using it for the load matrix.
