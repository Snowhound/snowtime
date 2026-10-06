# 10: Whole-server load and scaling

Status: complete for the agreed local protocol, 2026-10-06. Measurements, analysis,
and required checks pass. The read pool remains opt-in (`DB_READ_CONNECTIONS=0` by
default). Two/four-core pool cells and the dedicated-host repeat are deferred.

Worktree `/private/tmp/snowtime-081-load`, branch `081-load-and-scaling`. Merge into
`081-native-poc` without pushing. Preserve ignored evidence and the stopped stack's
retained M volume. Docker stays at Kait's 16-GiB setting (15.60 GiB usable, 10 vCPUs).

Compare the native host's API, rendered pages, and in-process TLS edge against one
TypeScript/Bun process behind Caddy. Keep the dataset, page-inclusive recording,
load model, compression, and replication cadence the same. Measure the single
connection before the read pool, then repeat the fixed loads and ramps with the pool.

## Final analysis, 2026-10-06

Keep `DB_READ_CONNECTIONS=0` as the default. The focused eight-core pool holds
65k users on M and 30k on L, versus single's 50k and 5k. One-core M holds
15k with one reader versus 25k with single. The agreed focused protocol is complete;
intermediate pool sizes and a dedicated-host repeat remain follow-up work.

These are two-minute holds following one-minute ramp steps on a shared Mac/Docker VM.
They measure the ported, page-inclusive slice with gzip and local-file replication,
not full-app capacity or S3 replication. Sequential runs retain live writes and warm
filesystem cache. M sessions are renewal-eligible; L finishes before renewal becomes
eligible. All focused holds render October 6. The fresh-source matrix and prepared
comparisons remain separate evidence. No confidence intervals or causal scaling law
follow from these single observations.

### Held offer and core efficiency

All nine focused holds have zero counted HTTP errors and dropped actions, and generator
headroom. M single's 30k one-core hold narrowly misses its 1,036-ms open-page window
before 25k passes. The table records the first failed ramp step separately from holds.
Request rates use the 120-second offered window. CPU uses valid adjacent
samples and their observed duration; app CPU includes the native TLS edge. Bun's proxy
CPU is separate. Users per assigned core describes resource allocation, not physical
performance-core affinity or measured CPU utilization.

| Dataset / assigned cores | Mode        | Held users | First failed step | HTTP/s | App CPU cores | Users / assigned core |
| ------------------------ | ----------- | ---------: | ----------------: | -----: | ------------: | --------------------: |
| L / 1                    | Single      |      4,000 |             6,500 |   82.3 |         0.157 |                 4,000 |
| L / 1                    | Pool        |      5,000 |             8,000 |  103.4 |         0.205 |                 5,000 |
| L / 8                    | Single      |      5,000 |             6,500 |  103.7 |         0.243 |                   625 |
| L / 8                    | Pool        |     30,000 |            40,000 |  622.0 |         1.216 |                 3,750 |
| L / 8                    | Bun + Caddy |     25,000 |            30,000 |  518.2 |         1.072 |                 3,125 |
| M / 1                    | Single      |     25,000 |            40,000 |  517.4 |         0.642 |                25,000 |
| M / 1                    | Pool        |     15,000 |            20,000 |  310.5 |         0.412 |                15,000 |
| M / 8                    | Single      |     50,000 |            65,000 | 1034.4 |         1.494 |                 6,250 |
| M / 8                    | Pool        |     65,000 |            80,000 | 1346.5 |         2.988 |                 8,125 |

From one to eight assigned cores, M single's held offer grows 2× and pool's 4.33×;
L single grows 1.25× and pool 6×. Allocation efficiency therefore falls to
25%/54% of the respective one-core M value and 16%/75% on L. These ratios describe
observed endpoints; L one-core replication overlap prevents a controlled gain claim.
Fresh-source M single holds at 1/2/4/8 cores are 30k/30k/40k/40k; Bun holds
15k/25k/20k/25k. Fresh-source L single holds 3k/8k/5k/4k, and Bun holds
10k/20k/15k before its eight-core comparison moves to the prepared protocol.
Neither matrix supports linear scaling from more assigned cores.

At the eight-core L hold, Bun uses 1.072 app cores plus 0.346 proxy cores.
Native pool completes 622 HTTP/s at 1.216 app cores versus Bun's 518 HTTP/s.
App-plus-edge CPU per HTTP attempt is 1.97 ms versus 2.76 ms. M pool uses
2.24 ms per attempt versus single's 1.46 ms at different held offers. Removing
serialization can improve capacity while raising work per request; these figures
are mixed-load process costs, not isolated SQL costs.

### Matched calls and page latency

The one-core 5k controls complete about 103–104 HTTP/s in every native mode.
M single/pool uses 1.83/1.89 app CPU ms per attempt and peaks at 123/127 MB app RSS.
L single/pool uses 2.02/1.84 ms and peaks at 149/130 MB. L pool overlaps restart
compaction; M source restoration and session maintenance can change cache state.
These are matched offers, not matched request mixes or quiet-replication controls.

The following client p95s come from canonical method/path trends at that 5k offer.
The rows identify canonical calls in the return action and the week-report action.
Each return call has 1,678/1,685 observations on M single/pool and 1,681/1,624 on L.
Timer pages have 150/172 and 155/168 observations. Week report calls have only
42/32 and 40/44 observations; their tails are less stable.

| Call / action          | M single ms | M pool ms | L single ms | L pool ms |
| ---------------------- | ----------: | --------: | ----------: | --------: |
| Timer page / open      |       61.90 |     74.95 |       89.13 |    107.41 |
| Session / return       |       13.96 |     11.82 |       22.84 |     38.28 |
| Running timer / return |       15.30 |     12.96 |       24.20 |     42.43 |
| Entries / return       |       19.90 |     17.16 |       29.34 |     53.30 |
| First start / return   |       20.23 |     17.92 |       28.31 |     49.32 |
| Projects / return      |       24.64 |     22.74 |       35.20 |     77.16 |
| Week report / report   |        2.75 |      1.32 |        7.56 |      1.77 |

Access-log server p95s at 5k are 61/72 ms for M's timer page and 16/14 ms for
return APIs; L is 87/102 ms and 26/52 ms. Rare month/year pages have only 1–7
requests per window and do not establish their tail. The isolated kind groups below
give 60–61 page/auth actions each and 60–61 API actions with several calls per action.
All four focused native kind runs finish without errors or drops. Raw summaries retain
every canonical call and both client and server distributions.

### CPU by request kind

App CPU ms per HTTP request includes rendering, its internal API calls, compression,
and TLS. API rows average over the calls in the action. Each one-core group runs
for 30 seconds at two actions/second; background app work can affect this estimate.

| Isolated action        | M single ms | M pool ms | L single ms | L pool ms |
| ---------------------- | ----------: | --------: | ----------: | --------: |
| Timer page             |       43.79 |     47.92 |       42.09 |     39.88 |
| Return APIs            |        2.69 |      3.30 |        2.35 |      2.09 |
| Timer APIs             |        1.13 |      1.23 |        0.88 |      0.97 |
| Edit APIs              |        0.88 |      1.00 |        0.69 |      0.63 |
| Week APIs              |        2.01 |      1.98 |        1.89 |      1.74 |
| Month page             |       39.35 |     44.92 |       36.01 |     42.95 |
| Month APIs             |        2.40 |      2.68 |        2.75 |      2.00 |
| Year page              |       45.43 |     47.29 |       45.46 |     45.51 |
| Year APIs              |        4.13 |      3.11 |        3.94 |      2.76 |
| Sign-in follow-up APIs |        1.90 |      2.41 |        1.83 |      2.74 |
| Sign-in auth           |       81.69 |     82.88 |       81.60 |     75.60 |

The render-thread mean CPU for timer/month/year pages is 25.13/20.66/23.29 ms
on M single and 27.44/22.24/24.72 ms with one reader. L is
23.36/18.75/23.11 ms and 20.39/17.72/21.63 ms. This excludes host API workers.
Those API workers average 0.22–3.23 ms blocking CPU per external API call across
these groups. The aggregate process CPU above includes costs neither thread metric
covers. Mean scrypt CPU is 79.55/80.23 ms on M and 79.72/73.74 ms on L, accounting
for almost all isolated sign-in auth CPU. The pool does not accelerate the hash.

### Queue and worker bounds

The eight-core return-API timing p95s distinguish asynchronous admission from
connection serialization. Percentiles are independent distributions and must not
be added to reconstruct a request. These holds use different offers.

| Dataset / mode | Admission ms | Connection wait ms | Connection hold ms | Blocking queue ms | Blocking CPU ms |
| -------------- | -----------: | -----------------: | -----------------: | ----------------: | --------------: |
| M / single     |       151.47 |               3.08 |               3.51 |              0.06 |            3.52 |
| M / pool       |         4.20 |               0.28 |               6.40 |              0.24 |            5.24 |
| L / single     |        12.08 |               4.40 |               5.39 |              0.36 |            5.39 |
| L / pool       |         0.00 |               0.00 |               4.83 |              0.14 |            4.45 |

M single queues before admission despite using only 1.494 of eight app CPU cores.
Its timer page has 280.52-ms render elapsed p95 but only 27.40-ms render CPU p95.
Pool reduces admission and raises usable parallel work: timer render elapsed/CPU p95
is 83.22/41.38 ms at 65k. Render queue p95 stays below 0.1 ms in both M holds.
L single/pool return admission falls from 12.08 ms to below reported precision,
while connection hold remains about 5 ms. This supports connection serialization as
a bottleneck in those single runs. It does not isolate every SQL operation.

Both eight-core pool holds peak at 18 live DB/hash blocking workers, within ten DB
plus eight hash slots. M/L one-core single peaks at 3/3, and one-reader pool at 4/4,
within their configured limits. The counter excludes workers used only for Tokio file
I/O; process thread counts also include render/runtime threads. Final SQLite
busy/locked counters remain zero. Cumulative render refusal counters retain prior
overloads and do not turn the error-free holds into failures. Async admission queues
are time-limited, not fixed-count memory bounds: M eight-core pool samples up to 117
waiting DB callers. Cancellation retains permits until blocking work completes.

### WAL, replication, and memory budget

M/L eight-core pool holds record 86/55 passive checkpoints taking 1.075/0.963 seconds
in total. WAL file peaks are 46,918,592/15,005,072 bytes; final live frame counts
are 484/1. The sampler's WAL-index snapshot is racy diagnostic state, not a count
of busy-handler retries or a transaction-consistency proof. Litestream averages
0.039/0.034 CPU cores in these holds, and its final sync/compaction verification
error counters are zero. Checkpoints continue with concurrent readers; this short
window does not establish long-reader WAL bounds. The completed M and L restore
checks supply the data-correctness evidence. Production remains pinned to 0.5.0;
benchmark 0.5.15 is a tested candidate, not a deployment change.

M eight-reader snapshots observe 10.837 MB of page cache and 2.148 MB of statements
in aggregate (1.62 MB per reader). L observes 9.565/2.039 MB (1.45 MB per reader).
These separate sampled maxima omit checked-out readers. Budget at least 2 MiB per
reader plus statements and connection overhead; the SQLite cache setting is soft.
Loaded RSS differences also include renderer growth, hash buffers, and queued work.
They cannot measure the incremental cost of a connection.

M/L eight-core pool peaks are 679/606 MB app RSS, 731/1,071 MB simultaneous
app/replication RSS, and 1,003/1,248 MB simultaneous cgroup memory. Native idle
RSS is roughly 55–56 MB for the completed L eight-core pair, before pages grow the
render pool. Bun's L app/proxy/replication peaks simultaneously at 876 MB RSS and
1,134 MB cgroup memory; its proxy has 15 MB peak swap. Native app swap is zero in
the focused holds, but replication retains swap and fresh L startup uses swap even
at a 512-MiB physical allocation. The 32/64-MB whole-server target is not met.

Use 2 GiB for M and 4 GiB for L as provisional deployment test budgets, including
OS, replication, and filesystem cache; validate startup and sustained load on the
dedicated host before adopting a cap. M's measured warm process footprint fits 2 GiB,
but this shared 16-GiB VM does not prove a standalone 2-GiB limit. L needs headroom
for its 4.7-GB database and replication startup. A larger swap-free replication
allocation needs measurement. File pages can remain charged to earlier containers,
and RSS and cgroup memory account mappings differently. The generator and unrelated
services share the VM, so summing these figures cannot predict total host RAM.

### Remaining bottlenecks and removal cost

- **Connection serialization:** the implemented opt-in pool raises the held eight-core
  offer 1.3× on M and 6× on L. Its cost is additional connections/caches, read/write
  route classification, and session maintenance through the writer. One-core M's
  regression rules out enabling it universally. Two/four-core pool behavior is unmeasured.
- **Page rendering:** render-thread CPU is about half the isolated native page process
  cost. Eliminating all of that CPU gives an arithmetic upper bound near 2× for that
  isolated cost, not measured capacity. Render caching requires invalidation for timer
  state, sessions, user zones, and current dates. Task 091 and profiling should establish
  the hot work before adding that complexity.
- **Password hashing:** scrypt dominates sign-in CPU. Removing it is not an equivalent
  workload; the measured faster implementation is already in subtask 08. More hash
  concurrency costs buffers and competes with DB/render CPU; eight-core pool peaks at
  three simultaneous hashes, so these holds do not justify increasing its limit.
- **SQL/cache and storage:** year API blocking CPU is higher than other API kinds,
  and historical cold L reads show elapsed time well beyond thread CPU. Query profiles
  can distinguish scans, allocation, and I/O. Index/schema changes require migration
  and write-cost checks; query-result caches require invalidation. No removal gain is
  measured here.
- **Bun request-loop stalls and replication startup:** L's failed Bun step has 33 heap
  sampler timeouts; fresh replication compaction can consume CPU and swap. Profiling
  and dedicated-host startup controls can test attribution. More Caddy memory or a
  Litestream version change has resource/restore costs and needs its own measured
  deployment decision. No extra optimization or production pin change is made.

### Final verification

Required checks pass on the final tree:

- Cargo format; workspace clippy with warnings denied and tests in default and `bench`
  builds (39 unit tests per build; the existing manual render smoke test stays ignored).
- A release binary rebuilt from the current render bundle; default timer conformance
  (13 tests) and byte-for-byte `compare.ts` in both `DB_READ_CONNECTIONS=0` and `auto`.
  Broader unported domains remain outside this POC's conformance claim.
- `bun run test`: 447 Bun tests and 179 component tests, with no failure to ignore.
- Sampler `go test ./...` in the existing `golang:1-alpine` image, network disabled
  and source mounted read-only; no benchmark service starts.
- Harness lint/format, project type checking, and knip. Type checking fixes the optional
  historical sampler `swap` field and narrows the render bundle's locale type.
- A small stopped-WAL fixture verifies the read-only restore inputs. It compares committed
  rows in ordinary and `WITHOUT ROWID` tables, retains DB/WAL SHA-256 hashes, sizes, and
  modification times, and rejects changed replica data. Evidence is
  `perf/.cache/stress/081-readonly-fixture-1791294420245/`. L's preserved `stopped/`
  archive remains untouched.

Final check logs are `/private/tmp/081-*-final.log`. The benchmark stack stays stopped;
its retained live volume contains M. Historical L restart commands are not executed.

## Resume after the account-quota pause, 2026-10-06

This handover is completed by the final analysis and checks above. Its remaining-work
list records the pause state, not further restart instructions.

Kait requests a handover after the running measurements finish. The focused M driver
exits successfully after its final 65k pooled hold. All focused M/L measurements,
one-core fixed/kind controls, L's prepared TypeScript comparison, and L restore
verification are complete. No new load run is required by the agreed protocol.
Two/four-core pool cells remain deferred.

The live `snowtime_bench_data` volume now contains M. Do not run the historical L
`--prepared` continuation against it. The retained M replica is
`perf/.cache/stress/replica/081-focused-M-1791289890241`. L's earlier replica, sources,
raw runs, and restore artifacts remain preserved. App writes stop, replication catches
up, and all four benchmark containers stop under the shared guard. The lock is released.
Unrelated services remain running. Docker stays at 16 GiB; production's Litestream
0.5.0 pin is unchanged. Benchmark replication uses 0.5.15.

The pause artifact is `perf/.cache/stress/081-quota-pause-1791293602090/`. It preserves
before/after container inspection, service logs, transaction/UTC state, a stopped M
DB/WAL/SHM snapshot, and table counts. Phase logs are `/private/tmp/081-focused-M.log`
and `/private/tmp/081-focused-L-resume.log`. The matrices are
`perf/.cache/stress/081-focused-matrix.json` and the preserved original single matrix.
`081-baseline-preservation.json` verifies that the original matrices remain unchanged.

| Dataset / cores | Single held users | Pool held users | Single / pool app CPU cores | Single / pool peak app RSS MB |
| --------------- | ----------------: | --------------: | --------------------------: | ----------------------------: |
| M / 1           |            25,000 |          15,000 |               0.642 / 0.412 |                     209 / 292 |
| M / 8           |            50,000 |          65,000 |               1.494 / 2.988 |                     596 / 679 |
| L / 1           |             4,000 |           5,000 |               0.157 / 0.205 |                     158 / 160 |
| L / 8           |             5,000 |          30,000 |               0.243 / 1.216 |                     241 / 606 |

All nine focused holds, including L TypeScript's eight-core 25k, have zero counted
HTTP errors and dropped actions, with generator headroom. M pool's 65k hold uses
0.603 k6 CPU cores on its two assigned cores, peaking at 1.011 cores. M's first
failing steps are single/pool 40k/20k at one core and 65k/80k at eight. M single's
30k hold narrowly misses a 1,036-ms open-page window before 25k passes. All four
M/L native one-core kind runs complete their eleven groups without errors or drops.
Raw folders retain every attempt and all canonical call latency/timing distributions.

The recorded default decision is `DB_READ_CONNECTIONS=0`. `auto` improves the held
eight-core offer by 1.3 times on M and six times on L, but M's one-reader hold is
lower than single's. Keep the pool opt-in. These are short sequential observations,
not confidence intervals or a universal scaling law. L's one-core single ramp and
resumed pool fixed controls overlap substantial replication work; do not claim their
ratio as a controlled gain. M source sessions are renewal-eligible throughout this
phase; the first restored single run and later retained runs can have different
maintenance/cache state. All these holds render October 6 in generated user zones.

Checkpoint skipping passes end to end for both datasets. Full `--prepared --resume`
replays leave raw file sizes and modification times unchanged. L also verifies recovery
of a completed child's capacity after temporarily omitting its matrix row. Evidence is
`081-resume-verification.json`, `081-resume-M-verification.json`, and adjacent logs.

Remaining work:

1. Finish the analysis and final task status. `/private/tmp/081-analyze.py` now includes
   all completed focused cells and correct error types. Its refreshed output is
   `perf/.cache/stress/081-analysis.json`; `/private/tmp/081-analysis-final.log` records
   its summary. Complete matched per-call/page latency, CPU-kind/timing, per-core
   efficiency, worker bounds, WAL/checkpoint, whole-host memory advice, and bottleneck
   costs. Keep cache/clock/replication caveats and the shared-VM limitation. M/L eight-core
   pool holds record 86/55 passive checkpoints in 1.075/0.963 seconds, with WAL peaks
   46,918,592/15,005,072 bytes. Their simultaneous app/replication RSS peaks are 731/1,071
   MB and cgroup peaks 1,003/1,248 MB. Reader cache/statement observed aggregates are
   10.837/2.148 MB for M and 9.565/2.039 MB for L; checked-out readers are absent from
   these snapshots. Both eight-core pool runs peak at 18 live DB/hash workers, within
   the configured limit, and have zero final SQLite busy/locked errors.
2. Verify the new read-only input mode in `verify-restore.ts` with a small WAL fixture.
   The full L integrity/schema/count/ordered-hash verification passed before this
   change. Its original copied WAL was checkpointed by the old read/write verifier;
   `restore-L-0515/stopped/` preserves an untouched stopped snapshot. Keep that archive
   untouched. `knip.jsonc` now includes nested benchmark CLI files. Neither latest change
   has had final lint/type/project checks in this session.
3. Run the required checks while load is stopped: Cargo format, default/bench workspace
   clippy with warnings denied and tests, a current release binary, `conformance.ts` and
   `compare.ts` with `DB_READ_CONNECTIONS=0` and `auto`, `bun run test`, sampler Go tests,
   changed harness lint/format, project type checks, and knip. Ignore only the already
   authorized near-midnight timer-view “starts after today's last entry” failure.
   Default native conformance covers the ported timer suite; broader unported domains'
   404s are outside this POC. The prior checks recorded below predate this continuation.
4. Commit in `081-load-and-scaling`, then merge into `081-native-poc` at
   `/Users/kaitkasak/projects/snowtime/snowtime-081-poc`. Preserve its task 11/12 and task
   05 documentation and task-index changes. `/private/tmp/081-target-docs.json` has hashes
   for the protected task files. The target is clean at handover. Commit and merge remain
   authorized. Do not push, remove the worktree, or delete ignored evidence or volumes.

The next session can start with analysis and checks; it does not need to restart Docker
services. If a further benchmark control is justified, inspect host idleness and own
`perf/stress/lock.ts` before restarting only the retained M benchmark containers. Never
restore or clear metadata merely to run a prepared control.

## Historical resume after the 2026-10-06 deadline pause

This sequence is completed. The live volume now holds M; retain these instructions
as the L phase's historical handoff, not the next session's restart procedure.

Kait set a 13:00 Europe/Tallinn (10:00 UTC) pause deadline and requested a restart
prompt for a cleared session. Continue the focused analytical protocol below, not
the original exhaustive pool matrix. All changes remain uncommitted. Merge and final
checks remain authorized after the remaining work; do not push.

1. Verify the Mac has no competing benchmark/build/test and use `perf/stress/lock.ts`.
   Keep Docker at its verified 16-GiB setting and leave unrelated services alone.
2. Retain the live L database in `snowtime_bench_data` and its replica at
   `perf/.cache/stress/replica/081-load-native-single-8c-ls0515-1791273282085`.
   Do not call `loadDataset` or clear metadata before finishing the prepared L phase.
   Restart only the saved benchmark containers under the shared lock: app, Litestream,
   Caddy, and sampler. The continuation guard requires running Litestream and the same
   replica mount, image, and memory. Its Docker VM source may have `/host_mnt` prepended;
   the guard and new driver normalize that prefix.
3. Continue with
   `bun native/bench/scaling/focused.ts --dataset=L --prepared --resume --typescript --litestream-image=litestream/litestream:0.5.15`.
   The new resume path retains completed native ramp decisions, complete fixed
   validity/diagnostics files, and fully collected eleven-group kind runs. It also
   recovers a completed child's capacity file if the paused parent did not save its
   matrix row. Incomplete raw runs remain evidence and are repeated. Verify the
   resume behavior when idle; changed driver/continuation/resume files pass lint/format
   at the pause, but checkpoint skipping has not yet run end to end and final type/project
   checks remain.
4. Finish L one/eight-core native single/pool pairs and the prepared eight-core
   TypeScript ramp. The two/four-core pool cells are deferred by the agreed scope.
   The first prepared single one-core ramp overlaps substantial Litestream restart
   work. Use a short contemporaneous single control if needed before claiming its
   ratio to the later pool run as a causal gain; do not restart the original M matrix.
5. Verify L restore after stopping app writes and catching up replication.
   `perf/.cache/stress/081-restore-L.ts` is a prepared controller that owns the shared
   lock and invokes `native/bench/scaling/verify-restore.ts`. It has not run yet.
   It saves stopped live DB/WAL/SHM, restores with 0.5.15, and compares integrity,
   schema, all table counts, and ordered row hashes. Check its commands before use.
6. Run `bun native/bench/scaling/focused.ts --dataset=M --litestream-image=litestream/litestream:0.5.15`
   to restore M once and pair single/pool one/eight-core measurements. Preserve the
   original M rows. Record session-age/day differences: M source renewal eligibility
   starts 04:13:44 UTC and L at 16:17:54 UTC on October 6. A later session can cross
   the L threshold or local midnight. Document maintenance and page dates, and keep
   contemporaneous controls where attribution matters; never rewrite pinned sources.
7. Complete latency/per-call CPU, reader memory, bounded-worker, WAL/checkpoint,
   Litestream, and whole-host memory analysis; resolve the read-pool default (still 0).
   The ignored helper `/private/tmp/081-analyze.py` now reads the single, pool, and
   focused matrices and writes `perf/.cache/stress/081-analysis.json`. It is an analysis
   aid, not a required repository tool. Prepared process RSS and cgroup memory have
   different cache accounting; retain the shared-VM/page-cache caveat in host advice.
8. Finish docs and checks while load is stopped: default/bench workspace clippy and
   tests, `conformance.ts` and `compare.ts` in both connection modes, `bun run test`,
   sampler Go tests and changed harness lint/format. Ignore only the known near-midnight
   timer-view “starts after today's last entry” test. Default conformance covers the
   ported timer suite; the unported domains' 404s are outside this POC.
9. Commit and merge into `081-native-poc` in
   `/Users/kaitkasak/projects/snowtime/snowtime-081-poc`. Preserve its task 11/12 and
   other documentation changes. Do not push or remove this worktree or ignored data.

Completed raw measurements and the exact pause checkpoint are recorded below. The
focused phase log is `/private/tmp/081-focused-L.log`; original L baseline log is
`/private/tmp/081-L-single-resume.log`. The full-matrix launcher was intentionally
stopped after native's eight-core child completed; all original M rows are intact.

## Machine and run protocol

The Mac has 32 GiB RAM and 10 physical cores: eight performance cores and two efficiency
cores (`sysctl hw.memsize hw.ncpu hw.perflevel0.physicalcpu
hw.perflevel1.physicalcpu`). Docker Desktop exposed 10 vCPUs and
8,319,504,384 bytes (7.75 GiB) RAM for the first runs. Kait increased it to 16 GiB on
resume; verified usable memory is 16,745,824,256 bytes (15.60 GiB). The 8-core app limit
and k6 share this VM, so monitor actual memory rather than adding nominal limits. Confirm how the
VM schedules performance and efficiency cores; a Linux cpuset does not prove physical
performance-core affinity on macOS.

The first pair uses core 1 for the app, Caddy, sampler, and Litestream. k6 has cores
2–9. The shared guard in `perf/stress/lock.ts` reserves the stack and checks competing
benchmark processes. A process inspection before the pair found no competing builds,
tests, dataset generator, or k6. Build images and datasets before measuring. Run no
other builds or checks during load.

The initial limits retain the existing harness defaults: app 1,792 MiB, Caddy 512 MiB,
Litestream 128 MiB, sampler 40 MiB. Their sum exceeds 2 GiB; these exploratory runs do
**not** prove a whole-server 2-GiB memory cap. The baseline must record simultaneous
RSS and revise the total budget before claiming task 078's host target. Native mode's
Caddy only exposes the sampler and is excluded from its application path.

The initial runs use Litestream 0.5.0 and a local-file target under
`perf/.cache/stress/replica/`, with the self-hosted config's one-second sync, daily
snapshot, and seven-day retention. Local replication does not measure S3 latency.
The first startup logs a compaction error before SQLite's page size is initialized;
check subsequent logs, a successful replica restore, and initial snapshot completion
before treating replication as steady state. First-run snapshot work must be separated
from sustained replication costs.

The M database is `M-2026-10-05-4eca24bf5f2a.db`: 60 generated companies, 1,072 people,
1,172,096 generated entries beside the seed, 1,049 users with sessions, and 944 MB.
Both runs reload this file. `slice-pages.json` comes from
`recordings/full-2026-10-04.json` through `native/bench/api-recording.ts`. It keeps timer
and report pages, ported API calls, and email sign-in; export and the signed-out
sign-in page remain outside native parity. This is whole-host traffic for the ported
slice, not complete application capacity.

The source database date is pinned across midnight with `--dataset-date`; this
selects the preserved input file, not a simulated application clock. API recording
filters keep their recorded ranges. Rendered pages use the current server/user
date, so runs across midnight can change the timer's day. Record raw UTC times
and avoid attributing a day-dependent page difference entirely to connection
mode. M and L runs remain in the same month/year and use freshly restored sources.

M source sessions first become eligible for daily renewal at
2026-10-06 04:13:44 UTC; L at 2026-10-06 16:17:54 UTC. Their initial expiry
is 30 days after generation. Include maintenance traffic when interpreting
runs beyond these thresholds; restored input hashes do not freeze session age.

## First fixed-load pair

Two 120-second M runs offer 40,000 active users with gzip and one connection.
The TypeScript run completed 63,451 HTTP attempts, with 6,846 dropped actions,
52,129 timeout errors, 7,308 connection errors, and 28 5xx errors. Client p95 is
30,001 ms. Its post-run sampler TLS request failed (`curl` exit 35), so the harness
exited before saving its step samples and server-window report. This run is invalid
for capacity and the CPU/RSS comparison. Dropped actions require checking generator
headroom; they do not alone prove that k6 saturated. Retain the raw summary for
diagnostics and rerun at a lower offered load after fixing collection. A failed
fixed load does not establish capacity. No ramp or pool gain has been measured yet. Both first runs are invalid for capacity.
The benchmark containers are stopped, and the shared reservation is released.

Raw folders follow the existing timestamp/dataset/run/label convention in
`/private/tmp/snowtime-081-load/perf/.cache/stress/runs/`:

- `2026-10-05T04-15-08-M-fixed-081-load-ts-single-1c-fixed40k`
- `2026-10-05T04-29-26-M-fixed-081-load-native-single-1c-fixed40k`

Logs are `/private/tmp/081-first-{ts,native}.log`; build logs are
`/private/tmp/081-{ts,native,caddy,sampler}-image.log`. Preserve image digests, settings,
idle readings, step samples, summaries, and replication logs with the raw run folder.

### Native diagnostic result

The native half saves its full report and 123 one-second samples. It offers 778.8
HTTP attempts/s, completes 766.3/s, returns 1,020 counted 5xx errors (1.09%), and drops
1,326 actions. It misses the page and API latency windows. These are overload
diagnostics, not a passing capacity or a clean CPU comparison with TypeScript.

| Process               | CPU, one-core percent | Peak RSS MB | Peak cgroup MB |
| --------------------- | --------------------: | ----------: | -------------: |
| Native app and edge   |                  78.5 |         364 |            787 |
| Litestream            |                  19.0 |         100 |            134 |
| Instrumentation Caddy |                   0.1 |          52 |             59 |
| Sampler               |                   0.3 |          18 |             25 |

Native idle app RSS is 53 MB; TypeScript idle app RSS is 104 MB. These exclude the
proxy and replication. The native app plus Litestream reach 447 MB simultaneous RSS.
The failed run cannot set the production memory target. Native aggregate application
CPU is 1.0 ms/HTTP attempt; it includes rendering, internal API reads, and the edge.

The native WAL grows from 24,752 to 172,302,552 bytes. Litestream reads 10.72 MB/s
and writes 1.90 MB/s at the cgroup level. Its saved log includes completed level-1
compactions; a replica restore and checkpoint analysis remain outstanding.

The sampler's printed **k6 CPU 0.0% is wrong**: it calculates a whole-window delta
across container disappearance and stale process discovery. Only positive adjacent
intervals with existing counters give a usable diagnostic here: 118 intervals average
37.8% of one core and peak at 99.3%, against eight assigned cores. k6 peaks at 1,305 MB
RSS. This suggests CPU headroom, but the dropped actions still invalidate capacity.
Check the scenario's virtual-user ceiling and add process identity to counter samples
before claiming valid generator headroom for the matrix.

Native `Server-Timing` diagnostics, milliseconds:

| Request kind | Mean blocking CPU | Connection wait p95 |       Hold p95 | Blocking queue p95 |
| ------------ | ----------------: | ------------------: | -------------: | -----------------: |
| Return API   |             0.912 |               3,597 |           6.14 |              3,492 |
| Start API    |             0.169 |               3,587 |           2.93 |              3,408 |
| Edit API     |             0.115 |               3,446 |           2.17 |              3,446 |
| Sign-in auth |            65.931 |      uninstrumented | uninstrumented |              3,250 |

The CPU column measures the blocking thread, excluding TLS/compression and V8 CPU.
Page CPU is not separately instrumented yet. Successful open pages have renderer-queue
p95 957 ms; whole-response p95 includes failed pages and is about 14 seconds. Month
and year pages also reach roughly 14 seconds. See `fixed.txt` for every request kind.

The app reaches 525 threads, 518 active blocking calls, 2,954 queued blocking calls,
one renderer, and all 64 render queue slots occupied. Scrypt's sampled active peak is
three, with four concurrent hashes recorded by its peak counter: roughly 128 MiB of
ROMix buffers at that concurrency, from the unchanged 32-MiB-per-hash parameters.

Connection and blocking queues dominate elapsed time while holding the connection
usually takes milliseconds. The read pool may remove part of that wait; the failed
run does not quantify its capacity gain. Any blocking-pool admission change needs
separate measurements and is outside this implementation. Replication also consumes
19 percentage points of the same core, so a steady-state control must distinguish
replication work from contention before drawing a tuning conclusion.

The resumed matrix pins `--dataset-date=2026-10-05`. Input hashes are retained in
`perf/.cache/stress/081-inputs.json`:

| Input                          | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| M, 944,087,040 bytes           | `85580db1a5b808d2b21d3acf856268cd674769af5fbdf349b5565530e04e984a` |
| L, 4,712,255,488 bytes         | `2669dadd3aa53d338da12a007444708afb80a9030abe010e82dfafb06972c3a4` |
| Page-inclusive slice recording | `2c55b145f37122fc78c6d56ef2ce80c83ff347b8b46ae248649e6cc2266e553b` |

## Bounded work and 40k repeat

DB admission now happens before `spawn_blocking`. `DB_CONCURRENCY` defaults to readers
plus two. `SCRYPT_CONCURRENCY` defaults to available cores. Both queues use
`WORK_QUEUE_TIMEOUT_MS` (default 1,000 ms) and return 503 with `Retry-After: 1` when
admission expires. The host sets Tokio's maximum blocking threads to the sum of those
two limits. Sign-in releases DB admission before hashing and reacquires it to create
its session. Renderer API calls run on the host runtime. Cancelling a caller keeps its
permit until its blocking work finishes; tests cover cancellation and timeout.

Repeat controls retain the original 1,792-MiB app limit, M dataset, one connection,
gzip, and 120-second 40k offer. Later capacity cells use the whole-server budget below.

| Measurement                   | Before, with replication | Bounded, without replication | Bounded, with replication |
| ----------------------------- | -----------------------: | ---------------------------: | ------------------------: |
| Peak app threads              |                      525 |                            9 |                         9 |
| Peak active blocking DB calls |                      518 |                            2 |                         2 |
| Peak scrypt concurrency       |                        4 |                            1 |                         1 |
| App peak RSS (MB)             |                      364 |                          184 |                       205 |
| App CPU, one-core share       |                    78.5% |                        92.1% |                     84.9% |
| Litestream CPU / peak RSS     |           19.0% / 100 MB |                       absent |            11.1% / 105 MB |
| Open page p95                 |               about 14 s |                       1.16 s |                    2.53 s |
| Dropped actions               |                    1,326 |                            0 |                         0 |
| End WAL bytes                 |              172,302,552 |                    4,181,832 |               176,607,952 |

The blocking-thread collapse is gone. 40k remains an overload diagnostic, not capacity.
The replication repeat returns 5,735 5xx responses (5.82% total errors); common API p95
is about one second as admission expires. App admission peaks at 872 waiting callers,
with two admitted; the renderer queue peaks at 38. Async waiting still consumes memory.
The no-replication repeat peaks at 521 waiting callers. k6 mean CPU is 34% of one core,
peak one-second CPU below 68%, on eight assigned cores, with zero dropped actions.

Raw folders:

- `2026-10-05T06-45-07-M-fixed-081-bounded-native-single-1c-no-rep-40k`
- `2026-10-05T06-48-29-M-fixed-081-bounded-native-single-1c-rep-40k`

Each folder retains per-call/page trends, complete requests, samples, service logs,
image IDs, and queue counters. The direct loopback sampler succeeds under overload.
CPU rates now compare adjacent samples from the same cgroup generation, report observed
seconds, and rediscover processes every second. VU ceilings cover all sequential calls
in an action at the HTTP timeout; these repeats dropped no actions. Ramps stop a size
on generator CPU saturation or dropped actions and save their decision in
`capacity.json`. Every remaining size begins with a ramp.

### WAL checkpoint ownership

Without replication, SQLite auto-checkpointing holds the WAL near 4.2 MB. With pinned
Litestream 0.5.0, WAL live frames grow from 6 to 42,866 while only 6 frames are backfilled.
The app's normal auto-checkpoint cannot advance past Litestream's retained read lock.
Litestream's [0.5.0 source](https://raw.githubusercontent.com/benbjohnson/litestream/v0.5.0/db.go)
disables auto-checkpoint on its connection and comments out the checkpoint branch in
`Sync()`. This explains the previous 172-MB WAL and the repeated 176.6-MB growth.
Changing its checkpoint threshold alone cannot enable that disabled branch.

Proposed tuning: measure a checkpoint-capable Litestream release before updating the
self-hosted pin. Start with its passive checkpoint defaults and the same one-second
replication cadence. Record live/backfilled frames, checkpoint duration, writer p95,
WAL size, and replica restore correctness. The [current configuration reference](https://litestream.io/reference/config/)
and [WAL truncation guide](https://litestream.io/guides/wal-truncate-threshold/)
describe passive checkpoints and a forced truncation threshold. Forced truncation can
stall writers and requires a boundary snapshot. Do not add an app-owned truncation loop
against the replication read lock. Production's version and settings remain unchanged
until that comparison supports a change.

## First resumed capacity result and pause point

The M native single-connection ramp uses one core, a 1,536-MiB app limit, gzip, direct
TLS, and Litestream 0.5.0. The 2-GiB whole-server budget reserves 128 MiB for replication
and 384 MiB for the OS; the sampler is separate benchmark instrumentation.

| Step                               | Result                                                         |
| ---------------------------------- | -------------------------------------------------------------- |
| 10k / 12.5k / 15k, 60 seconds each | Pass                                                           |
| 20k, 60 seconds                    | First failure: sign-in API p95 401 ms in a 30-second window    |
| 15k, 120-second hold               | Pass: 311.4 completed requests/s, no errors or dropped actions |

At the passing hold, client p95 is 115 ms for return API, 54 ms for start, 48 ms for
edit, 76 ms for week reports, and 296 ms for sign-in auth. Page p95 is 239 ms for open,
59 ms for month reports, and 253 ms for year reports. App mean CPU is 44.6% of one core,
peak RSS 174 MB, and cgroup peak 634 MB. Litestream mean CPU is 8.5% of the same core,
peak RSS 100 MB, and cgroup peak 134 MB. k6 mean CPU is 15.0% of one core, with 118
observed seconds and a one-second peak of 25.4%, on eight assigned cores. App threads
peak at nine. These are one-ramp/one-hold observations; replication compactions and
scheduler variance still need matched repeats before estimating removal gains.

Raw folder: `2026-10-05T06-55-29-M-ramp-081-load-native-single-1c-ramp`.
Its `capacity.json` records 15k passing and 20k first failing.

The following 5k fixed run was stopped before offering load: its runner reused the
ramp replica after restoring the source DB. The runner now creates a fresh replica
for every stress invocation. No fixed result from that attempt is valid or recorded.
The new startup gate waits for the initial replica compaction to finish before idle
sampling. The earlier 40k replication control overlaps that initial compaction; retain
it as an overload/thread-bound result and repeat it for steady-state replication cost.
The no-replication 40k control remains available for that pair.

Resume sequence (updated 2026-10-06):

1. Continue in `/private/tmp/snowtime-081-load`, branch `081-load-and-scaling`.
   All implementation and documentation changes remain uncommitted. Preserve the
   ignored datasets, replicas, and raw runs in this worktree.
2. Confirm the Mac is idle, Docker still has 16 GiB, and the shared stress lock has
   no live owner. The task's app, Caddy, Litestream, and sampler containers are stopped;
   the stress lock is absent at handoff. Leave unrelated services alone.
3. M single-connection measurements at 1/2/4/8 cores are complete, including corrected
   1-core fixed loads and request-kind runs. Use the later corrected results below.
   The Caddy 512-MiB probe is also complete; it gives no held-capacity gain.
4. Validate the provisional 512-MiB Litestream budget with a fresh L snapshot and
   initial compactions, then finish L single-connection baseline and scaling. Resume
   the matrix with `--phase=single --datasets=L --dataset-date=2026-10-05` and
   Litestream 0.5.15. Existing M matrix rows must remain intact.
5. Run the pool matrix for M and L with the same pinned inputs and whole-server
   budgets. Every size starts with a ramp. Stop a size when k6 cannot drive it.
   Keep Docker at the user-selected 16 GiB; do not provision remote machines.
6. Account for session renewal before comparing modes: M source sessions become
   renewal-eligible at 2026-10-06 04:13:44 UTC, and L at 16:17:54 UTC that day.
   Later runs can include writer-side renewal absent from the earlier baseline.
   Preserve source hashes and document or control this difference, plus page-date changes.
7. Finish large-dataset restore verification, diagnostics, memory recommendations,
   and measured bottleneck proposals. Run the required checks, commit, and merge into
   `081-native-poc` in `/Users/kaitkasak/projects/snowtime/snowtime-081-poc`.
   Preserve its task 11/12 documentation changes. Do not push.

The latest native image, `7387139d1c5f05826689c0bcc2dfcc9a0c3a36779d1f050fdc19bb8eeee6d627`,
includes the blocking-worker counters and session-maintenance lock fixes described
below. It passes the recorded checks and is now measured by the first L ramp below. Existing M
runs use the earlier images recorded in their raw folders.

The latest native bench image includes final SQLite busy/locked error counts and render
Busy-answer counts, compiled out of default builds. Bench workspace clippy/tests pass
with these counters. Earlier default workspace checks, both-mode conformance/byte
comparisons, and Bun tests pass before this diagnostic-only addition. Repeat final
checks before merging. The corrected ramp runner passes harness lint/format checks;
its fresh-replica/startup gate still needs execution after the pause.

## Second resume: production-pin ramp and checkpoint candidate

The first resumed M/native/1-core ramp on the 16-GiB VM passes short steps through
30k and first fails at 40k. Its 120-second holds at 30k, 25k, and 20k all fail, so
`capacity.json` establishes no capacity. At the end, WAL growth adds about 760 MB,
app cgroup memory peaks at 1,435 MB, and app peak RSS reaches 262 MB. The 20k hold
misses common API targets by 8–22 ms in failing windows. k6 has substantial headroom
and drops no actions. WAL growth coincides with degradation; the ramp also mutates
timer entries, so the fixed fresh-dataset controls must isolate the cause.

Raw folder: `2026-10-05T16-28-35-M-ramp-081-load-native-single-1c-ramp`.
The lower-start repeat is interrupted when Kait selects a checkpoint-capable release
for the full matrix. Preserve completed steps, exclude the interrupted step and any
capacity claim. Raw folder:
`2026-10-05T16-44-35-M-ramp-081-load-native-single-1c-ramp`.

Kait selects the tested checkpoint-capable release for the full matrix (2026-10-05).
The matched diagnostic compares no replication, Litestream 0.5.0, and 0.5.15
under the same fresh M/40k/120-second offer and 1,536-MiB app limit. Checkpoint
progress, WAL bounds, and replica restore verification pass for 0.5.15.
Production deployment files retain their existing version and settings. Matrix labels
include the replication version; preserve its image ID with each run.

## Matched checkpoint controls

All three controls use the same fresh M source, 40k offer, 120-second load, one app
core, zero readers, and 1,536-MiB app limit in the verified 16-GiB Docker VM.
Replication starts before warmup. Every run has nine app threads, zero dropped
iterations, and k6 CPU headroom. All three miss at least one app target, so these
are overload diagnostics rather than capacity results.

| Replication | App CPU, one-core % | Peak app RSS, MB | Open page p95, ms | Return call p95, ms |           5xx | Peak WAL, bytes | Litestream CPU / peak RSS |
| ----------- | ------------------: | ---------------: | ----------------: | ------------------: | ------------: | --------------: | ------------------------- |
| Off         |                95.0 |              268 |             1,238 |                 297 |   319 (0.32%) |       4,185,952 | —                         |
| 0.5.0       |                91.7 |              198 |             1,421 |                 652 | 1,782 (1.79%) |     180,497,232 | 4.1% / 67 MB              |
| 0.5.15      |                92.4 |              183 |             1,211 |                 251 |   208 (0.21%) |      12,961,552 | 1.2% / 99 MB              |

Litestream 0.5.15 records 51 passive checkpoints and 0.609 seconds of cumulative
checkpoint time during the load. Final WAL counters show 1,212 live frames and 1,177
backfilled frames. Version 0.5.0 retains 43,810 live frames with only six backfilled.
This establishes the checkpoint and WAL improvement. The latency differences are
single-run observations; they do not establish a repeatable capacity gain.

After stopping the app and letting replication sync, restore from the 0.5.15 replica
passes SQLite integrity checks. Schema, every table's row count, and SHA-256 hashes
of ordered rows match the stopped live database, including its retained WAL. The
verification artifact is `perf/.cache/stress/restore-0515/verification.json`.

Raw folders under `perf/.cache/stress/runs/`:

- `2026-10-05T16-53-39-M-fixed-081-checkpoint-native-single-1c-no-rep-40k`
- `2026-10-05T16-57-36-M-fixed-081-checkpoint-native-single-1c-ls0.5.0-40k`
- `2026-10-05T17-10-27-M-fixed-081-checkpoint-native-single-1c-ls0.5.15-40k`

The readiness gate now accepts the initial level-zero upload, then warms for 60
seconds. Waiting for a scheduled snapshot unnecessarily delayed the 0.5.15 control
by about ten minutes. The first matrix fixed loads reveal that level-one initial
compaction becomes eligible after the first writes. Their 1k/5k results include
startup compaction cost. The first TS fixed run additionally shows an initial level-two full-seed compaction
at the five-minute interval. Waiting only for level one still includes that startup
cost. Later invocations warm with writes and wait for the initial level-two
compaction before measured steps. Ramps use their existing 30-second
warmup; other local replicated runs use a 500-user, 30-second warmup. Preserve the
startup-inclusive fixed runs and repeat both apps' M/one-core ramps, 1k/5k offers, and kinds under the corrected gate
with `matrix.ts --phase=single --datasets=M --cores=1` and explicit 0.5.15/date flags.
Keep all first attempts as startup-inclusive diagnostics.

## Checkpoint-capable matrix progress

The M native single-connection, one-core ramp first fails at 40k. Holds at 30k and
25k narrowly exceed the open-page 1,000-ms window target. The 20k hold passes all
targets with no errors or dropped actions: 413.3 completed requests/second, 50.8%
app CPU, 215-MB peak app RSS, and nine threads. Open-page client p95 is 220 ms;
return-call p95 is 76 ms. Litestream averages 1.4% CPU and peaks at 39-MB RSS during
that hold. These hold-specific peaks exclude earlier startup and ramp peaks.

Raw folder: `2026-10-05T17-27-49-M-ramp-081-load-native-single-1c-ls0515-ramp`. This establishes 20k as the passing held offer for this
run, with 40k as the first failing ramp step. The corrected repeat below supersedes this held offer; pool gain remains pending. The first isolated-kind invocation
`2026-10-05T17-49-56-M-kinds-081-load-native-single-1c-ls0515-kinds` is invalid:
k6 rejects colons in scenario names. Its zero-count tables reuse the warmup summary
and must not be interpreted. Scenario names now use dashes while recording aliases
retain colons. The harness deletes the previous summary before each invocation and
rejects unexplained nonzero k6 exits. The corrected native kind run below replaces this invalid invocation. Each later invocation restores the source database before loading.

The corresponding TypeScript/Caddy ramp first fails at 15k and passes its 12.5k
hold: 258.7 completed requests/second, 49.0% app CPU plus 9.3% Caddy CPU, 423-MB
peak app RSS, 157-MB peak Caddy RSS, and eight app threads. Open-page client p95 is
60 ms and return-call p95 is 24 ms at its own passing hold. Litestream averages 3.5%
CPU and peaks at 96-MB RSS. Both held offers have zero errors/drops and ample k6
headroom. Native's held modeled capacity is 1.6 times TypeScript's in this first M
pair. The corrected pair below supersedes it after initial level-two compaction. The p95 values above are at different loads and do not compare matched latency.

Raw folder: `2026-10-05T17-51-51-M-ramp-081-load-ts-single-1c-ls0515-ramp`. The failed 15k TS step has 2-second API and 4–7-second
page p95 windows and stalled heap-sampler answers. Its final WAL is under 5 MB.
The libSQL file client serializes statements/transactions and documents that a busy
wait blocks the process (`src/db/connection.ts`). These observations suggest a
request-loop/serialized-work bottleneck, but do not identify the particular blocking
operation. The initial level-two full-seed compaction overlaps that failure. The corrected TS ramp and later scaling/kind results below supersede this
startup-inclusive comparison.

M/native/single at two cores and a 4-GiB whole-server budget first fails at 50k.
Its 40k hold narrowly misses a sign-in follow-up API window (318 ms, target 300).
The 30k hold passes: 621.1 completed requests/second, 79.3% of one core in app CPU,
331-MB peak app RSS, and 14 threads. Litestream averages 1.6% CPU and peaks at 43-MB
RSS during that hold. k6 averages 29.8% of one core and has zero dropped actions.
This matches the corrected one-core held offer, for 50% relative per-core
efficiency.

At failing 50k, return-call timing p95 is 372 ms for DB admission, 2.37 ms waiting
for the connection, 3.68 ms holding it, and 0.895 ms in the blocking queue. The gate
limits two DB calls before the connection, so much serialized-work waiting appears
in admission rather than directly at the mutex. Do not interpret the small mutex
wait alone as proof that the single connection has spare capacity. The pool comparison
remains necessary. Raw folder: `2026-10-05T18-17-32-M-ramp-081-load-native-single-2c-ls0515-ramp`.

M/TypeScript at two cores and the same 4-GiB target first fails at 30k and passes
25k held: 514.9 completed requests/second, 95.8% Bun CPU plus 23.0% Caddy CPU,
606-MB peak app RSS, 248-MB peak Caddy RSS, and ten app threads. Litestream averages
1.3% CPU and peaks at 36-MB RSS during the hold. No errors/drops; k6 averages 23.2%
of one core. Native holds 1.2 times this modeled offer at two cores. Bun's near-one-core
CPU and failed-step request-loop stalls suggest a single-process CPU limit, pending
four/eight-core contrast. Caddy peaks near its 256-MiB cgroup limit but has zero OOM
kills and no sustained memory pressure in the hold; retain its counters when attributing
the failure. Raw folder: `2026-10-05T18-34-22-M-ramp-081-load-ts-single-2c-ls0515-ramp`.

M/native/single at four cores first fails at 65k. The 50k hold fails; 40k held passes
with 830.3 completed requests/second, 1.103 cores of app CPU, 411-MB peak app RSS,
and 24 threads. Litestream averages 1.7% CPU and peaks at 35-MB RSS during the hold.
Its 43 passive checkpoints take 0.587 seconds cumulatively, and WAL peaks at
11,993,352 bytes. No errors/drops in the hold; k6 averages 34.4% of one core.
Capacity is 1.33 times both the corrected one-core and two-core offers.
Relative per-core efficiency is 33% of the corrected one-core result.

Across this ramp and its holds, four renderers queue up to 30 jobs and return 346
Busy answers under overload. DB admission queues up to 856 callers; sampled blocking
work peaks at three active/two queued jobs, and scrypt peaks at three concurrent
hashes (within its four-hash limit). Final SQLite busy/locked errors remain zero.
These maxima include failing steps and must not be assigned to the passing hold.
The app uses well below four CPU cores while latency fails, making serialized DB
work a candidate bottleneck for the pool test. Raw folder: `2026-10-05T18-45-35-M-ramp-081-load-native-single-4c-ls0515-ramp`.

M/TypeScript at four cores first fails at 25k and passes 20k held. The passing hold
uses 76.1% Bun CPU plus 20.2% Caddy CPU, with 601-MB peak app RSS, 107-MB peak Caddy
RSS, and 17 app threads. Litestream averages 1.2% CPU and peaks at 48-MB RSS; k6
averages 16.9% of one core. No errors/drops. This run shows no capacity gain over the
two-core 25k result. Do not claim that four cores causally reduce capacity from these
single runs; retain the 20k–25k observed range and failed-step heap/sampler stalls.
Raw folder: `2026-10-05T19-05-29-M-ramp-081-load-ts-single-4c-ls0515-ramp`.

M/native/single at eight cores first fails at 50k on a narrow week-report API window
(310 ms versus 300). Its 40k hold passes with no errors/drops, 1.090 cores of app CPU,
633-MB peak app RSS, and 39 threads. Litestream averages 2.8% CPU and peaks at 39-MB
RSS during the hold. WAL peaks at 14,102,792 bytes; 58 passive checkpoints take
0.690 seconds cumulatively. k6 averages 31.3% of one core on its two assigned cores.
The full run reaches eight renderers, queues five renders at most, and has no Busy
answers or final SQLite busy/locked errors. DB admission queues up to 324 calls;
scrypt peaks at four concurrent hashes, within its eight-hash limit.

Held capacity matches four cores while app CPU stays near 1.1 cores. Relative
per-core efficiency is 17% of the corrected one-core offer.
The RSS difference from four cores includes extra renderers, workers, and hash
allocations; it does not measure reader-connection memory. Raw folder: `2026-10-05T19-19-10-M-ramp-081-load-native-single-8c-ls0515-ramp`.

M/TypeScript at eight cores first fails at 30k and passes 25k held: 96.8% Bun CPU
plus 26.9% Caddy CPU, 427-MB peak app RSS, 165-MB peak Caddy RSS, and 26 app threads.
Litestream averages 1.4% CPU and peaks at 41-MB RSS. No errors/drops; k6 averages
19.5% of one core on its two assigned cores. This matches the two-core held offer.
The 2/4/8-core single-process results span 20k–25k without a scaling gain. Near-one-core
Bun CPU and request-loop stalls suggest the JS/serialized-work path needs parallel
processes or worker isolation to use added cores; the current run does not measure
such a change. Raw folder: `2026-10-05T19-32-22-M-ramp-081-load-ts-single-8c-ls0515-ramp`.

| M, single connection              | Native held users | TypeScript held users | Native CPU cores at hold | Bun + Caddy CPU cores at hold |
| --------------------------------- | ----------------: | --------------------: | -----------------------: | ----------------------------: |
| 1 core / 2 GiB (corrected repeat) |            30,000 |                15,000 |                    0.707 |                         0.702 |
| 2 cores / 4 GiB                   |            30,000 |                25,000 |                    0.793 |                         1.188 |
| 4 cores / 8 GiB                   |            40,000 |                20,000 |                    1.103 |                         0.963 |
| 8 cores / 16 GiB                  |            40,000 |                25,000 |                    1.090 |                         1.237 |

Every held row has no dropped actions and k6 headroom. The corrected native
one-core hold has two 5xx responses within its error threshold; other held rows
have zero errors. The corrected one-core rows use the level-two startup gate. These are single held observations, not confidence intervals.

### Corrected M one-core repeat

The rebuilt native repeat
`2026-10-05T20-17-25-M-ramp-081-load-native-single-1c-ls0515-ramp` waits
for initial level-two compaction before ramping. Steps through 30k pass; 40k
first fails with 0.24% errors, open-page window p95 of 1,309 ms, and return-call
window p95 of 343 ms. At this overloaded point, app peak threads remain nine,
peak RSS is 184 MB, and app swap is zero. App CPU averages 91.9% of one core.
k6 averages 34.5% of one core, with a one-second peak of 64.3%, against its
eight-core allocation. No generator limit or OOM is observed.

The 30k two-minute hold passes: 619.7 completed requests/second, 70.7% app CPU,
187-MB peak app RSS, nine threads, and zero app swap. Open-page client p95 is
463 ms; return-call p95 is 114 ms. Two 5xx responses are within the 0.1% error
threshold; there are no dropped actions. Litestream averages 1.3% CPU and peaks
at 36-MB RSS, with 4-MB swap remaining. k6 averages 25.6% of one core. This
corrected 30k result supersedes the first 20k baseline. The corrected fixed/kind runs and TypeScript repeat below complete this M
one-core pair. L and pool comparisons remain pending.

Relative to this corrected native baseline, observed held offers at 2/4/8
cores are 1.0/1.33/1.33 times one-core capacity. Per-core efficiency is
50%/33%/17%. These replace ratios calculated against the earlier 20k result.
Separate runs and diagnostic image versions limit causal attribution; the
read-pool comparison is still pending.

The corrected native 1k fixed run
`2026-10-05T20-31-05-M-fixed-081-load-native-single-1c-ls0515-fixed1000`
passes at 20.5 requests/second, with no errors/drops. Open-page client p95 is
66 ms, return-call p95 is 20 ms, app CPU averages 6.3%, and peak app RSS is
108 MB. Litestream averages 0.5% CPU, with 104-MB peak process RSS and 5-MB
peak swap during the measured load. Per-kind CPU comes from the isolated runs;
this mixed run averages 3.1 ms app CPU per request.

The corrected native 5k fixed run
`2026-10-05T20-38-49-M-fixed-081-load-native-single-1c-ls0515-fixed5000`
passes at 103.8 requests/second with no errors/drops. Open-page client p95 is
61 ms, return-call p95 is 17 ms, app CPU averages 19.0%, and peak app RSS is
145 MB (idle 54 MB). Litestream averages 0.6% CPU, with 108-MB peak process
RSS and 32-MB peak swap during load. k6 averages 8.5% of one core. The two
month-page requests and six year-page requests are sparse samples; retain
the isolated page runs rather than treating their mixed-run p95 as precise.

The new swap samples show that M's 128-MiB Litestream budget uses about 67 MB
of swap during startup. This is separate from the 512-MiB resumed L diagnostic
that finishes without observed swap. Reserve startup headroom in the final
memory proposal; steady-state RSS alone does not cover full-database replication.

### Corrected TypeScript one-core ramp, M

Raw folder: `2026-10-05T20-52-21-M-ramp-081-load-ts-single-1c-ls0515-ramp`.
Steps through 20k pass after initial full compactions. The 20k step completes
413.8 requests/second with 74.1% app CPU plus 14.5% Caddy CPU, 362-MB peak
app RSS, 94-MB peak Caddy RSS, and no errors or swap in either.

The 25k step fails severely: 51.53% errors, including 9,783 timeouts. Caddy
reaches its 256-MiB physical cap (268 MB), uses 204-MB peak swap, and records
10% memory-pressure and 34% I/O-pressure time. Its disk reads average
46.90 MB/second. App CPU falls to 26.0% while Caddy consumes 33.4%; app
peak RSS is 718 MB, app swap is zero, and neither container OOM-kills. k6
uses 22.6% of one core on average, peaking at 1.184 cores against eight
assigned cores. No dropped actions or generator limit is recorded.

The one-second time series shows the order: app plus Caddy consume about
97% of their shared core in the first 3–14 seconds. Caddy reaches its RAM
cap around second 12 and starts swapping around second 18. App CPU then
falls, reaching near zero around second 40 while Caddy remains in reclaim/I/O.
The shared CPU budget saturates first; queue growth and proxy memory pressure
amplify the failure. The app's direct health check continues to respond.
The earlier TypeScript results lack swap samples and do not isolate the Bun
request loop from this proxy limit. Retain the 256-MiB results as the baseline.
The 20k hold following overload fails with 75.79% errors and continued proxy
swap/I/O pressure. The 15k hold recovers and passes with zero errors/drops:
310.2 completed requests/second, 58.9% app CPU plus 11.3% Caddy CPU,
557-MB peak app RSS, and 263-MB peak Caddy RSS. Both have zero swap during
this hold. Litestream averages 0.9% CPU and peaks at 40-MB RSS; k6 averages
12.4% of one core. Open-page client p95 is 116 ms. This supersedes the earlier
12.5k hold and establishes a conservative post-overload offer of 15k, versus
native's corrected 30k. A fresh 20k step passes, but post-overload recovery at
that offer is not demonstrated.

The completed Caddy redistribution probe,
`2026-10-05T21-38-43-M-ramp-081-caddy512-ts-single-1c-ramp`, raises Caddy to
512 MiB and reduces the app to 1,024 MiB within the same 2-GiB host target.
Steps through 20k pass; 25k still fails on latency, with open-page p95 about
12 seconds and return-API p95 6,031 ms. It records no HTTP errors, dropped
capacity actions, app/proxy swap, or OOM kills. At 25k, app CPU averages 76.9%
and Caddy 17.3%; peak RSS is 770 MB and 450 MB respectively. k6 averages
22.2% of one core and peaks at 51.6%, against eight assigned cores.

The 20k hold recovers to zero errors and swap but narrowly fails the sign-in
follow-up API's 30-second-window p95 at 362 ms. The 15k hold passes at
311.5 requests/second, with app CPU 56.8%, Caddy CPU 10.9%, and peak RSS
596 MB and 343 MB. Its open-page p95 is 66 ms. The larger proxy budget removes
the severe swap/I/O collapse in this run but leaves held capacity at 15k.
Shared-core CPU remains the first limit. This single probe supports a recovery
benefit, not a capacity increase or a change to the full matrix's proxy budget.

The corrected TypeScript 1k fixed run
`2026-10-05T21-06-39-M-fixed-081-load-ts-single-1c-ls0515-fixed1000`
passes at 20.8 requests/second with no errors/drops. Open-page client p95 is
71 ms, return-call p95 is 35 ms, app CPU averages 12.3% plus 2.2% Caddy CPU,
and peak RSS is 220 MB for the app plus 61 MB for Caddy. Litestream averages
0.5% CPU and peaks at 104-MB RSS with 25-MB swap. k6 averages 3.8% of one
core. This mixed low-load run averages 6.0-ms app CPU plus 1.05-ms Caddy CPU
per request, versus native's 3.1 ms for its direct whole app.

The corrected TypeScript 5k fixed run
`2026-10-05T21-13-48-M-fixed-081-load-ts-single-1c-ls0515-fixed5000`
passes at 104.0 requests/second with no errors/drops. Open-page client p95 is
37 ms and return-call p95 is 15 ms, versus native's 61 and 17 ms at the same
offer. App CPU averages 25.6% plus 4.3% Caddy CPU, versus native's 19.0%
for its direct whole app. Peak RSS is 271 MB for the app plus 61 MB for
Caddy, versus 145 MB native. Litestream averages 0.4% CPU and peaks at
110-MB RSS, with 16-MB peak swap. Native's higher held mixed capacity does
not imply faster pages at every load. Isolated action runs provide the
stronger comparison for sparse report-page samples.

### Native request-kind CPU, corrected M / one core

Raw folder: `2026-10-05T20-43-50-M-kinds-081-load-native-single-1c-ls0515-kinds`.
The corrected scenario names run all 11 action groups, with 60–61 actions each
at two actions/second for 30 seconds. Initial full compactions finish before
measuring. All groups meet latency targets with no errors or dropped actions.
CPU is sampled for the whole app container, including its direct edge. API
rows average the calls in their action; raw summaries retain each method/path.

| Action                 | Requests/action | App CPU ms/request | Server p95 ms |
| ---------------------- | --------------: | -----------------: | ------------: |
| Open page              |               1 |               46.7 |            64 |
| Return APIs            |               5 |                3.2 |            22 |
| Timer APIs             |               4 |                1.6 |             5 |
| Edit APIs              |               5 |                1.1 |             5 |
| Week APIs              |               3 |                2.3 |             4 |
| Month page             |               1 |               46.1 |            66 |
| Month APIs             |               5 |                3.7 |            22 |
| Year page              |               1 |               45.7 |            70 |
| Year APIs              |               5 |                4.3 |            26 |
| Sign-in follow-up APIs |               6 |                2.0 |            15 |
| Sign-in auth           |               1 |               83.0 |            88 |

The sign-in timing header attributes 80.16 ms mean thread CPU to scrypt
(p95 82.83 ms), versus 80.73 ms total blocking-work CPU. DB hold time averages
2.01 ms (p95 3.60 ms), and mutex wait averages 0.001 ms. The whole-container
83.0-ms figure also includes the edge and async work. This isolates hashing
from DB ownership; the writer is released during scrypt.

### TypeScript request-kind CPU, corrected M / one core

Raw folder: `2026-10-05T21-18-49-M-kinds-081-load-ts-single-1c-ls0515-kinds`.
This repeat supersedes the first valid run at 18:06 UTC. It waits for initial
level-two compaction and offers two actions/second per kind for 30 seconds.
Every row completes 60–61 actions, with no errors/drops. CPU comes from
integrated cgroup counters, including framework work. API rows average several
recorded calls; per-call distributions remain in the raw summary. Page rows
contain one rendered request. Caddy CPU includes TLS/compression.

| Kind                  | App CPU ms/request | Caddy CPU ms/request | Server p95 ms |
| --------------------- | -----------------: | -------------------: | ------------: |
| Timer page (`open`)   |               57.5 |                 4.50 |            68 |
| Return API            |                6.3 |                 1.72 |            34 |
| Timer API             |                7.1 |                 1.25 |            17 |
| Edit API              |                6.4 |                 1.08 |            21 |
| Week-report API       |                9.1 |                 1.57 |            24 |
| Month-report page     |               56.9 |                 3.94 |            71 |
| Month-report API      |                6.8 |                 1.14 |            31 |
| Year-report page      |               76.1 |                 3.85 |           131 |
| Year-report API       |               10.2 |                 1.13 |            30 |
| Sign-in follow-up API |                6.0 |                 0.96 |            34 |
| Sign-in auth          |               93.0 |                 2.32 |            95 |

These are low-rate isolated costs, not a throughput model for mixed traffic.
Caching, JIT warmup, and actor samples can differ. The matched 5k mixed run
shows faster TypeScript open pages even though its isolated page CPU cost is
higher. Use both the fixed-load observations and action runs when describing
the tradeoff.

## Third resume, 2026-10-06

The host check at 03:42 UTC finds no competing benchmark, build, or test. Only
Mailpit runs in Docker; the shared stress lock is absent before startup. Docker still
reports 16,745,824,256 bytes and 10 vCPUs. Unrelated services remain running.
The L-only single phase starts at 03:42 UTC with the preserved 2026-10-05 input,
Litestream 0.5.15, and the current native image. Existing M matrix rows remain intact.

Fresh L startup observations are in
`perf/.cache/stress/L-fresh-startup-2026-10-06/`. This observer shares the matrix's
owned stack and only reads process/cgroup counters and logs. It does not start another
stress session or stop replication. The first cell restores the source and uses a
new replica directory, with 512 MiB for Litestream and 1,152 MiB for native.
Initial level-two compaction completes at 03:52:59 UTC; the capacity matrix is running.

The earlier M single-connection matrix predates daily session renewal. Its page dates
span midnight in some user time zones: Europe/Tallinn reaches 2026-10-06 at
2026-10-05 21:00 UTC, during the corrected TypeScript ramp. Native's corrected one-core
ramp and fixed offers precede that boundary; TypeScript's corrected fixed offers follow
it. The resumed native L one-core ramp starts before New York midnight
(2026-10-06 04:00 UTC) and crosses it: European users render October 6 throughout,
while New York users initially render October 5. Later L runs and the pooled phase
render October 6 in all generated user zones. Source hashes and recorded report
filters remain pinned; page-date and session-age changes limit causal
claims across the pause. Record UTC bounds and renewal eligibility alongside later
phases rather than modifying the preserved datasets.

### Focused protocol, agreed on 2026-10-06

Kait asked to optimize for the analytical questions rather than complete every cell
in the original runner. Finish the current native eight-core L baseline, then pair
single and pooled native measurements at one and eight cores for L and M. Intermediate
two/four-core pool cells are deferred. Preserve every earlier baseline and raw folder.
The automatic matrix launcher is paused while its current child finishes.

The questions are pool gain in verified held capacity and tail latency, per-core
efficiency at the endpoints, memory per reader, replication/checkpoint costs, and
remaining bottlenecks. A fresh L snapshot and initial-compaction memory test has
already answered the startup question. Repeating it before each fixed offer or kind
run does not add independent startup evidence.

`native/bench/scaling/focused.ts` retains one live database and replica per dataset.
It measures L first to reuse the prepared stack, verifies its restore, then restores
the pinned M source once. Subsequent invocations use `--no-load`, retaining replica
metadata and the running replication process. It recreates app/proxy/sampler with
the cell's budgets and connection mode and updates Litestream's CPU affinity.
The harness checks the replica mount, image, and memory limit before continuing and
skips fresh-snapshot gates
only when it retains the database. Production's Litestream pin is unchanged.

Ramps start near existing held offers, keep 60-second steps and 120-second holds,
back off if the first step fails, and stop a size when the generator cannot keep up.
One-core single/pool controls each receive 1k/5k fixed offers and the complete isolated
kind run. Eight-core controls pair the connection modes; L also receives a prepared
TypeScript eight-core ramp. No new TypeScript M matrix is needed.

These are prepared-server measurements: page-cache state and accumulated benchmark
writes differ from the original fresh-source protocol. Compare the new single/pool
pairs to assess pool gain, retain row-count/state evidence, and use the original runs
as startup/cold-read diagnostics. Do not label the new pool-versus-old-single ratio a
controlled gain. Session age and local dates remain recorded; preserved source files
are never modified. This replaces the requirement to run every remaining cell exactly
as the original matrix did, not the final tests, analysis, restore checks, or merge.

### Pause checkpoint, 12:54 Tallinn / 09:54 UTC

All four task benchmark containers are stopped, both orchestration parents have
exited, and the shared lock is released. Their intentional launcher exits do not
invalidate the completed stress children. Unrelated services remain untouched.
No changes are committed or merged. The 13:00 local deadline is met.

The pause inspection also finds four unrelated Minupatsient PostgreSQL/test-DB
containers, started at 08:29:55–08:30:23 UTC with unrestricted cpusets. They start
after the last original L baseline's measured window (ends 08:13:38 UTC), but overlap
the focused phase. Their historical CPU/I/O was not captured, so host isolation for
focused results is not established. Leave those services alone; verify they and their
clients are idle before resuming, and retain this caveat rather than claiming a fully
isolated pool gain.

Original fresh-source L held capacities now recorded in `081-single-matrix.json`:

| Cores | Native users |            TypeScript users |
| ----: | -----------: | --------------------------: |
|     1 |        3,000 |                      10,000 |
|     2 |        8,000 |                      20,000 |
|     4 |        5,000 |                      15,000 |
|     8 |        4,000 | Prepared comparison pending |

The conservative one-core native decision has the startup-compaction/day caveats
above; do not treat this nonmonotonic table as a steady-state scaling law.
Original M rows remain unchanged.

Focused L one-core progress:

| Mode       | Held users | First failing ramp step | App CPU, one-core % | Peak app RSS MB | Litestream CPU % |
| ---------- | ---------: | ----------------------: | ------------------: | --------------: | ---------------: |
| Single     |      4,000 |                   6,500 |                15.7 |             158 |             32.8 |
| One reader |      5,000 |                   8,000 |                20.5 |             160 |              0.6 |

Both held windows have no errors or dropped actions. The pool's 6.5k hold fails
week-report windows at 339/313 ms, then 5k passes. The single 5k hold misses a
394-ms week-report window. The single fixed 1k passes (21.0 requests/second,
5.4% app CPU); its 5k fixed offer misses a 423-ms week-report window, despite
quiet replication. These observations support further pool investigation, but
4k versus 5k is not a clean causal gain: the initial prepared single ramp still
includes substantial replication restart work. Pool default remains 0 pending
endpoints, contemporaneous controls, and analysis.

The passing pool hold completes 103.4 requests/second. App/Litestream simultaneous
RSS peaks at 253 MB, versus 535 MB for the startup-affected single hold. This
reduction is primarily replication state, not reader memory savings. Both have
zero observed swap and no OOMs in their held windows. DB/hash workers peak at
3/4 executing blocking threads in single/pool mode; process threads peak at
9/10. Final SQLite busy errors are zero. The pool render-Busy counter is cumulative
from its earlier failing step; do not label it a new hold error.

Observed SQLite cache/statement maxima, MB: single writer 2.103/0.302; pool reader
2.908/0.287 plus writer 0.980/0.083. Reader page-cache configuration is a budget,
not a hard RSS bound. Full process RSS differences also include load/cache state.
WAL peaks are 4.48/4.66 MB. Further checkpoint and per-call analysis remains.

Completed raw folders:

- `2026-10-06T09-20-27-L-ramp-081-focused-native-single-1c-ls0515-ramp`
- `2026-10-06T09-28-30-L-fixed-081-focused-native-single-1c-ls0515-fixed1000`
- `2026-10-06T09-31-22-L-fixed-081-focused-native-single-1c-ls0515-fixed5000`
- `2026-10-06T09-34-15-L-kinds-081-focused-native-single-1c-ls0515-kinds`
- `2026-10-06T09-40-38-L-ramp-081-focused-native-pool-1c-ls0515-ramp`

The single kind run completes all eleven groups, 60–61 actions each, with no
validity misses. Its CPU/latency table is `kinds.txt`; the analysis artifact now
includes it. Pool fixed/kind measurements, both eight-core native controls, and
TypeScript eight-core L remain. Resume skips the completed one-core ramps and
single fixed/kind runs. The pool capacity row is saved manually after its child
exits while the parent is paused; no valid result is lost.

Pause artifacts: `perf/.cache/stress/081-pause-1791280426921/` contains service
logs and the retained configuration/mount checkpoint. Table counts before/after
are `081-focused-L-before.json` and `081-focused-L-pause-counts.json`: entries
increase from 5,952,503 to 5,957,639 (+5,136), sessions from 5,240 to 5,471 (+231).
These are net counts, not a count of every edit or write. The volume,
WAL/metadata, replica, pinned inputs, and all raw folders are preserved.

A safe restart of the saved containers, from this worktree, uses the shared guard:

```sh
bun -e 'const { checkOtherSessions, reserveStack } = await import("./perf/stress/lock"); checkOtherSessions(); const release = reserveStack(); try { const result = Bun.spawnSync(["docker", "start", "snowtime-bench-litestream-1", "snowtime-bench-app-1", "snowtime-bench-caddy-1", "snowtime-bench-sampler-1"], { stdout: "inherit", stderr: "inherit" }); if (result.exitCode) throw new Error("Cannot restart retained stack"); } finally { release(); }'
bun native/bench/scaling/focused.ts --dataset=L --prepared --resume --typescript \
  --litestream-image=litestream/litestream:0.5.15
```

Do not restore the source before this continuation. Restart work can affect the
first measured window; inspect replication CPU/logs and allow it to settle.
The next session must still perform L restore verification, the focused M phase,
final analysis/default decision, required checks, commit, and merge. The Hetzner
repeat instructions are expanded, but that deployment protocol is unexecuted;
Kait provisions its machines.

## Fourth resume, 2026-10-06

The host check at 11:36 UTC finds no competing benchmark, build, or test. Existing
Bun development/benchmark servers are idle. The unrelated PostgreSQL containers
measure 0.00–0.33% CPU, and Mailpit later has a brief 1.39% sample. Foreground GUI
processes still use host CPU. This is a local shared-Mac result, not dedicated-host
isolation. Docker retains 16,745,824,256 bytes and 10 vCPUs. Only the saved benchmark
containers restart, under the shared stress guard.

The prepared L continuation uses the retained live database and replica. Both original
one-core ramp decisions and all completed single fixed/kind runs are skipped. Pool
fixed offers at 1k and 5k pass with no errors or drops, completing 20.6/103.0 requests
per second. App CPU averages 4.7%/18.8%, and peak app RSS is 111/130 MB. Litestream
averages 41.1%/32.1% of the shared core during restart work. Its level-three full-copy
compaction completes at 11:42:04 UTC with 1,248,838,203 compressed bytes. The 5k
window has 151-MB peak replication swap. These fixed results include restart work;
they do not establish a quiet-replication pool latency gain.

The pool kind run completes all eleven groups without errors or dropped actions.
Its page CPU costs are 39.9/43.0/45.5 ms per request for timer/month/year, versus
42.1/36.0/45.5 in the prepared single run. Server p95s are 66/112/326 ms versus
59/62/92. API costs span 0.6–2.8 ms per request; sign-in auth uses 75.6 ms versus
81.6. These short isolated runs show no universal page-tail improvement, and their
replication state differs. Raw output retains each call's distributions.

The prepared eight-core native single ramp first fails at 6.5k, with 267 counted
5xx and four 4xx responses, and passes a 5k two-minute recovery hold without errors
or drops. Litestream stays near 1% CPU. The pool passes steps through 30k, first
fails at 40k on latency without HTTP errors or drops, and passes the 30k hold.
The paired held offer is six times single's. The pool uses 1.216 app CPU cores at
hold, versus 0.243 for single; neither consumes its eight-core allowance.
TypeScript first fails at 30k on broad latency and passes a 25k hold without errors
or drops. Its failed step has 33 direct heap-sampler timeouts, 1.129 Bun CPU cores,
0.359 Caddy cores, and 11-MB peak proxy swap. This supports a request-loop stall
candidate; it does not isolate a particular blocking operation.

L measured holds end at 12:20:22 UTC, before the source's 16:17:54 renewal threshold.
All generated user zones render October 6. Benchmark writes accumulate: this remains
the prepared protocol, separate from the original fresh-source baselines.

Resume verification runs the complete L command again with `--resume` and checks all
1,392 raw files' sizes and modification times. They remain unchanged. A second check
temporarily omits the native eight-core single matrix row and recovers that exact
row from the completed child's `capacity.json`, again without raw changes. The matrix
is restored after the check. Evidence is `perf/.cache/stress/081-resume-verification.json`
and its two adjacent resume logs.

App writes stop and replication catches up at transaction `00000000000011f4` before
L restore. Litestream 0.5.15 restores that transaction in 135,128 ms. Integrity checks pass, and schema, counts,
and ordered row hashes match for all 17 tables, including 5,979,997 time entries and
6,247 sessions. Relative to the pause, these net counts increase by 22,358 and 776.
Artifacts remain in `perf/.cache/stress/restore-L-0515/`. An untouched stopped
DB/WAL/SHM snapshot is also retained in its `stopped/` directory before M is loaded. The verifier now opens its inputs read-only,
so future checks preserve their DB/WAL copies instead of checkpointing them on close.

### Reader memory and limits in the completed L pair

The eight-reader L hold samples 9.565 MB of reader page-cache memory and 2.039 MB
of reader statement memory, or 1.45 MB per connection in that observed aggregate.
Single's writer cache/statement maxima are 2.103/0.361 MB; pool's writer is
0.849/0.083 MB. These are sampled maxima from idle connections. Checked-out readers
are absent from that snapshot, so this is not an upper bound on all reader memory.
The 2 MiB configured page cache is also a soft budget. The one-reader L hold observes
2.908 MB of cache plus 0.287 MB of statements on its reader. Budget at least the
configured caches plus statement/connection overhead; process RSS includes more.

At eight cores, idle single/pool app RSS is 55/56 MB. Loaded hold peaks are 241/606
MB at different offers and with three/eight renderers, so dividing that difference by
eight does not measure reader-connection overhead. Hash buffers and queued work also
change with offered load. Pool hold process threads peak at 48; the bench thread-local
counter sees 18 live DB/hash blocking workers, exactly the configured maximum of ten
DB slots plus eight hash slots. Single sees four such workers, within its ten-worker
maximum. No final SQLite busy/locked error is recorded. Render Busy counters include
earlier overloads; raw hold errors, not cumulative counters, decide hold validity.

Whole-server advice must include replication startup and filesystem cache. The L
pooled hold reaches 1.071 GB simultaneous app/replication process RSS and 1.248 GB
simultaneous cgroup memory. TypeScript's app/proxy/replication figures are 0.876/1.134
GB. These warm shared-VM observations are not standalone RAM caps: file pages can stay
charged to a previous container, process RSS and cgroup memory account mappings
differently, and the generator and unrelated services share Docker's 16-GiB VM.
Fresh L replication uses swap at its validated 512-MiB physical limit. A proposed
larger swap-free startup allocation still needs measurement. The 32/64-MB resident
memory target is not met once V8 rendering and replication are included.

## L replication startup memory

L startup does not fit the M replication budget. The first L one-core run
`2026-10-05T19-45-23-L-ramp-081-load-native-single-1c-ls0515-ramp`
only completes its warmup. Litestream reaches its 128-MiB RAM and 256-MiB
RAM-plus-swap limits, then exits with `OOMKilled=true` at 19:53:17 UTC. No L
capacity was measured.

A resumed 256-MiB trial,
`2026-10-05T19-54-43-L-startup-081-litestream-256m`, also fails. It
completes a 1,247,458,281-byte compressed snapshot at 19:59:16 UTC, but reaches
about 253-MB RSS and 268-MB swap, then OOM-kills at 19:59:53 UTC. The raw state
and logs preserve this failure; the early low-memory idle sample is not a
startup result.

The resumed 512-MiB diagnostic,
`2026-10-05T20-00-27-L-startup-081-litestream-512m`, completes the initial level-two compaction at 20:13:00 UTC.
Its process RSS high-water mark is 372,028 KiB (381 MB), with no swap observed
in 40 samples. This resumed diagnostic passes; the budget remains provisional
until a fresh L cell validates the complete startup. The runner deducts this reservation from
the same total host budget, leaving 1,152 MiB for one-core native and 896 MiB
for one-core TypeScript. Production configuration remains unchanged.

The fresh-source validation on 2026-10-06 passes snapshot and initial compactions
without an OOM kill. Snapshot completes at 03:48:43 UTC, initial level one at
03:49:21, and initial level two at 03:52:59. Their compressed sizes are
1,247,454,525, 1,247,454,525, and 1,247,461,108 bytes. Across 60 process samples,
RSS high-water reaches 498,424 KiB (510 MB) and swap reaches 70,684 KiB (72 MB).
The one-second sampler records 509,640,704 bytes of peak Litestream RSS and
197,885,952 bytes of peak cgroup swap; ten-second `/proc/1/status` samples can miss
shorter peaks and cover only that process. App plus Litestream reach 595,513,344 bytes
of simultaneous RSS during startup. The fresh startup is heavier than the resumed
diagnostic. The validated 512-MiB physical limit uses a 1-GiB memory-plus-swap limit;
it does not establish a swap-free 512-MiB startup. Raw process/cgroup observations, logs, completion state, and
one-second sampler data are in `perf/.cache/stress/L-fresh-startup-2026-10-06/`.
The selected ARM64 Litestream image is
`sha256:f45ca298a567bef6edd23d43429b5f80721473a9a9719e467f11d7888999403e`.

Litestream 0.5.15 starts snapshot and compaction monitors independently, and
its LTX 0.5.1 encoder retains an index entry for each database page. Concurrent
full-database work is therefore a plausible source of the startup peak, based
on the selected release's [store implementation](https://raw.githubusercontent.com/benbjohnson/litestream/v0.5.15/store.go)
and [encoder](https://raw.githubusercontent.com/superfly/ltx/v0.5.1/encoder.go).
The measurements show memory exhaustion; they do not attribute exact bytes to
each Go allocation. Startup headroom belongs in the whole-server memory target.

## L single-connection measurements, 2026-10-06

Native at one core first fails at 5k: month/week-report API windows reach
479/579 ms against 300 ms. The 4k hold fails a 319-ms week-report window and
returns 19 counted 5xx responses (0.19%). It overlaps the initial level-three
full-database compaction, completed at 04:03:25 UTC. Litestream averages 36.7%
of the shared core during the 5k step and 32.1% during the 4k hold. App CPU
averages 20.2% and 16.5%. These are operational replication costs and timing
confounders, not evidence of a request-CPU capacity ceiling at 5k.

The 3k two-minute hold passes with no errors/drops: 62.1 completed requests/second,
14.3% app CPU, 148-MB peak app RSS, and nine app threads. Litestream averages
0.8% CPU and peaks at 415-MB RSS during the hold as earlier allocations retire.
App plus Litestream peak simultaneously at 559 MB. WAL peaks near 4.5 MB;
k6 averages 6.3% of one core on eight assigned cores. Open-page client p95 is
62 ms and return-API p95 is 25 ms. This is one conservative post-failure hold,
not a steady-state upper bound independent of compaction timing.

Raw folder: `2026-10-06T03-44-00-L-ramp-081-load-native-single-1c-ls0515-ramp`.
It measures the current native image with worker counters and maintenance fixes.
The native 1k/5k fixed pair passes without errors or dropped actions. At 1k,
app CPU is 5.9%, peak RSS 109 MB, open-page client p95 75 ms, and return-API p95
24 ms. At 5k, it is 19.7%, 118 MB, 60 ms, and 24 ms respectively. Completed
request rates are 20.6/s and 103.4/s. The fresh 5k pass further shows that the
first 3k held result is not an upper bound independent of compaction timing.
Litestream averages 0.5% CPU in both fixed windows, with 6-MB peak cgroup swap.
Raw folders: `2026-10-06T04-06-45-L-fixed-081-load-native-single-1c-ls0515-fixed1000`
and `2026-10-06T04-21-15-L-fixed-081-load-native-single-1c-ls0515-fixed5000`.
The kind run, TypeScript baseline, and other core sizes remain in progress.
L source sessions are still fresh; M renewal eligibility begins at 04:13:44 UTC.

### TypeScript ramp, L / one core

Raw folder: `2026-10-06T04-55-03-L-ramp-081-load-ts-single-1c-ls0515-ramp`.
Steps through 15k pass. The 20k step returns 93 counted 5xx responses, one connection
error, and 5,221 timeouts (31.46% errors). Caddy reaches its 256-MiB physical cap,
peaks at 251-MB cgroup swap, and records 8% memory-pressure and 29% I/O-pressure time.
Bun peaks at 817-MB RSS with zero swap. Neither container OOM-kills. Bun's direct
heap sampler times out 32 times, showing request-loop stalls beyond the proxy alone.
Litestream uses only 0.5% CPU in this failed window. k6 averages 16.8% of one core
on eight assigned cores, with no dropped actions or generator-limit decision.

The 15k recovery hold fails with 18.32% errors; 12.5k then fails latency with no
counted errors. The 10k two-minute hold passes: 206.6 completed requests/second,
41.4% Bun CPU plus 7.7% Caddy CPU, 590-MB peak app RSS plus 177-MB peak proxy RSS,
and no errors or dropped actions. Both have zero swap in that hold. Litestream
averages 0.7% CPU, with 84-MB peak RSS and 10-MB peak cgroup swap.

The fresh TypeScript 1k fixed offer passes at 20.9 requests/second with no errors or
drops. Open-page client p95 is 70 ms, return-API p95 is 37 ms, Bun CPU averages
12.2% plus 2.1% for Caddy, and peak RSS is 231 MB plus 62 MB. Native's matched
figures are 75/24 ms, 5.9% CPU, and 109-MB app RSS. Litestream averages 0.5% CPU
and peaks at 382-MB process RSS with 7-MB cgroup swap during the TypeScript window.
Raw folder: `2026-10-06T05-25-55-L-fixed-081-load-ts-single-1c-ls0515-fixed1000`.

The TypeScript 5k fixed offer also passes: 103.0 completed requests/second, no errors
or drops, 27.0% Bun CPU plus 4.3% Caddy CPU, and peak RSS of 273 MB plus 63 MB.
The native matched offer uses 19.7% CPU and peaks at 118-MB app RSS. Litestream
averages 0.4% CPU, with 6-MB peak cgroup swap in the TypeScript measured window.
Raw folder: `2026-10-06T05-41-21-L-fixed-081-load-ts-single-1c-ls0515-fixed5000`.

The native 3k and TypeScript 10k held offers have different failure mechanisms and
initial-compaction overlaps. Their ratio is not a controlled steady-state comparison.
The fresh native 5k fixed pass and matched TypeScript fixed/kind runs provide the
lower-load contrast; preserve the conservative ramp decisions and their caveats.

### Native L / two cores, single connection

Raw folder: `2026-10-06T06-14-48-L-ramp-081-load-native-single-2c-ls0515-ramp`.
The ramp passes through 12.5k users. At 15k, the first failure is a 316-ms return-API
p95 in a 30-second window. No errors occur; app CPU is 56.0% of one core and
Litestream uses 0.9%. Holds at 12.5k and 10k also miss API latency windows. The
8k, 120-second hold passes all windows without errors or dropped actions.

The held offer completes 165.5 requests/second, uses 31.7% of one core, and peaks
at 208-MB app RSS with no app swap. Litestream averages 0.7% CPU, peaks at 85-MB
RSS, and retains 9-MB cgroup swap from startup. k6 averages 10.5% of one core
and peaks at 19.0%, against eight assigned cores. Process threads peak at 14.
Server open-page/return-API p95s are 125/99 ms. The saved matrix records 8k held
capacity and 15k as the first failing ramp step. Two cores do not remove the observed
API latency limit; pool measurements remain pending.

### TypeScript L / two cores, single connection

Raw folder: `2026-10-06T06-43-37-L-ramp-081-load-ts-single-2c-ls0515-ramp`.
The ramp passes through 20k users. At 25k, broad latency misses appear, including
1,541-ms return and 3,647-ms open-page p95s in 30-second windows. Eleven direct
heap-sampler requests time out. This does not isolate the proxy as the sole cause.

The subsequent 20k, 120-second hold passes all targets with no errors or drops:
415.2 completed requests/second, 77.8% of one core for Bun and 18.0% for Caddy.
Separate app/proxy peak RSS values are 603/140 MB; neither swaps. Litestream
averages 1.6% CPU, peaks at 64-MB RSS, and retains 5-MB cgroup swap. Server
open-page/return p95s are 39/16 ms. The direct heap sampler has no timeouts in
the hold. k6 averages 18.4% of one core and peaks at 43.6%, against eight assigned
cores. The matrix preserves 20k held capacity and a 25k first failing ramp step.
The two-core allocation improves TypeScript's verified L hold over one core;
these short runs do not predict long-duration production capacity.

### Native L / four cores, single connection

Raw folder: `2026-10-06T07-11-45-L-ramp-081-load-native-single-4c-ls0515-ramp`.
The first failing ramp step is 6.5k users: week-report API p95 reaches 335 ms in
a 30-second window. The subsequent 5k, 120-second hold passes without errors or
drops, completing 102.8 requests/second. App CPU averages 24.4% of one core and
peak RSS is 212 MB, with no app swap. Server open-page/return p95s are 49/25 ms.
Process threads peak at 20. Litestream uses 0.7% CPU, peaks at 52-MB RSS, and
retains 7-MB cgroup swap. k6 averages 8.1% of one core and peaks at 16.1%, against
six assigned cores. The matrix records 5k held capacity and a 6.5k first failure.

This hold is lower than the two-core result despite substantial CPU headroom.
Do not infer monotonic scaling from these short, latency-sensitive runs. Compare
connection timing and slow read calls before attributing the difference to cores.

### TypeScript L / four cores, single connection

Raw folder: `2026-10-06T07-30-37-L-ramp-081-load-ts-single-4c-ls0515-ramp`.
The first failing step is 20k users, with broad latency misses (974-ms return and
2,443-ms open-page p95s in 30-second windows) and one direct heap-sampler timeout.
The subsequent 15k, 120-second hold passes all targets without errors or drops,
completing 311.1 requests/second. App/Caddy CPU averages 61.2%/15.8% of one core;
separate peak RSS values are 626/125 MB, without app or proxy swap. Server
open-page/return p95s are 26/9 ms. Litestream averages 1.0% CPU, peaks at 70-MB
RSS, and retains 7-MB cgroup swap. k6 averages 13.2% of one core and peaks at 24.3%,
against six assigned cores. The hold has no heap-sampler timeouts. The matrix
records 15k held capacity and a 20k first failing ramp step.

### Native L / eight cores, single connection

Raw folder: `2026-10-06T07-56-01-L-ramp-081-load-native-single-8c-ls0515-ramp`.
The first failing ramp step is 5k users. The 4k, 120-second hold passes without
errors or drops, completing 82.9 requests/second. App CPU averages 21.5% of one
core and peak RSS is 214 MB, with no app swap. Server open-page/return p95s are
61/25 ms. Process threads peak at 25. Litestream averages 0.7% CPU, peaks at
69-MB RSS, and retains 7-MB cgroup swap. k6 averages 7.6% of one core and peaks
at 15.4%, against two assigned cores. The held offer remains latency-limited
well below the CPU allowance; connection timing analysis follows the prepared
pool comparison.

The current ramp's child finishes before the paused automatic launcher is stopped.
Its capacity row is copied into the existing single matrix, preserving all M rows.
The intentional launcher exit is not a failed stress run. The TypeScript eight-core
L comparison moves to the prepared protocol rather than another fresh snapshot.

### Native isolated kinds, L / one core

Raw folder: `2026-10-06T04-36-14-L-kinds-081-load-native-single-1c-ls0515-kinds`.
Every group completes 60–61 actions, with no dropped actions. Year-report APIs return
three admission-expiry 503s (0.98% errors); their CPU figure includes failed attempts.
The other ten groups have no counted errors. These low-rate rows include the direct
edge; API CPU is averaged over the calls in the action.

| Action                      | App CPU ms/request | Server p95 ms |
| --------------------------- | -----------------: | ------------: |
| Open page                   |               48.7 |            72 |
| Return APIs                 |                2.9 |            27 |
| Timer APIs                  |                1.2 |             5 |
| Edit APIs                   |                1.0 |             5 |
| Week APIs                   |                2.2 |             8 |
| Month page                  |               44.7 |           114 |
| Month APIs                  |                3.7 |            35 |
| Year page                   |               51.9 |            94 |
| Year APIs, including errors |                5.5 |            34 |
| Sign-in follow-up APIs      |                3.2 |            40 |
| Sign-in auth                |               81.7 |            87 |

In the year-API group, maximum connection hold is 1,658 ms while maximum blocking
CPU is 328 ms. App I/O-pressure time is 6% and reads average 3.00 MB/s; Litestream
uses only 0.4% CPU in that window. This demonstrates a long serialized read with
substantial elapsed time outside thread CPU. It does not identify the SQL operation
or prove that replication caused these errors. The pool comparison must retain this
cold-read and queue behavior, not only mean request CPU.

### TypeScript isolated kinds, L / one core

Raw folder: `2026-10-06T05-57-11-L-kinds-081-load-ts-single-1c-ls0515-kinds`.
Each group completes 60–61 actions without errors, dropped actions, or latency-target
misses. Caddy CPU is separate from app CPU; both are averaged over requests in the
action.

| Action                 | App CPU ms/request | Caddy CPU ms/request | Server p95 ms |
| ---------------------- | -----------------: | -------------------: | ------------: |
| Open page              |               60.3 |                 4.74 |            84 |
| Return APIs            |                7.0 |                 1.66 |            42 |
| Timer APIs             |                7.1 |                 1.16 |            19 |
| Edit APIs              |                6.3 |                 1.04 |            21 |
| Week APIs              |                9.1 |                 1.43 |            26 |
| Month page             |               56.3 |                 3.65 |            74 |
| Month APIs             |                7.5 |                 1.08 |            41 |
| Year page              |               72.3 |                 3.67 |           120 |
| Year APIs              |               10.4 |                 1.18 |            35 |
| Sign-in follow-up APIs |                6.2 |                 0.93 |            34 |
| Sign-in auth           |               94.5 |                 1.92 |            97 |

TypeScript uses more CPU per request in every isolated group. Latency varies by
kind: its month page and sign-in follow-up p95s are lower, while native has lower
p95s in most other groups. Native's year-API group includes errors, so its p95 is
not a clean successful-request comparison. At the matched 5k fixed offer,
TypeScript page/return p95s are 46/17 ms versus native's 60/24 ms. These samples
do not establish a universal latency advantage or predict mixed-load capacity.

## Read pool implementation

`DB_READ_CONNECTIONS=0` retains the single connection and remains the default.
`auto` selects one reader per available core; an explicit number up to 256 overrides
it. Every connection uses WAL. Readers open with SQLite's read-only flag and
`query_only`, a 2 MiB page-cache budget, and 64 cached prepared statements. The writer
keeps its 256-statement cache. Cache budgets fill on demand and are not RSS estimates.

GETs and POST routes explicitly marked as reads lease a bounded reader. The renderer's
in-process reads use that same router. Other calls use the writer. A lease returns its
connection when a request completes or fails. No extra query decides whether a route
can write.

The session check can write. It deletes an expired session and renews expiry after a
day. A reader finishes the SELECT before taking the writer for those operations. The
rule then continues on the reader. A regression test verifies renewal and deletion
through the writer, visibility from two readers, rejected writes on a reader, and
returned leases. The maintenance fix rechecks the session after acquiring
the writer, so a stale reader cannot delete or shorten another reader's freshly
renewed session. The extended regression uses a held WAL snapshot to exercise
both stale renewal and stale expiry. The helper now acquires the writer only
from a read-only connection; a writer-owned request reuses its lock. A
time-bounded regression covers both renewal and expiry in single-connection
mode, preventing the previous helper's reentrant-lock deadlock. Both regressions pass, and the rebuilt image includes the fix. Sign-in still releases the writer while scrypt runs.

Keep `DB_READ_CONNECTIONS=0` as the default. The prepared eight-core L pair gains
six times the held offer with `auto`, but one-core M holds 15k with one reader versus
25k on single. These short observations have cache/state and replication caveats;
they support an explicit workload-specific option rather than a universal `auto`
default. Intermediate two/four-core pool cells remain deferred.

## Instrumentation and checks

The Cargo `bench` feature adds connection wait/hold and thread CPU, Tokio blocking
queue and CPU timings, render queue timings, and one-second SQLite page-cache and
statement memory, cache hits/misses/writes, blocking queued/active calls, scrypt
active/peak concurrency, and render count/queue counters. Default builds compile these
new diagnostics out. Linux supplies thread CPU; macOS reports zero for that field.
The sampler records app, proxy, Litestream, and k6 CPU/RSS, process threads, WAL size,
and cgroup disk reads. k6 retains server-timing distributions by request kind.

Per-call latency is grouped by canonical recorded method/path. The latest bench image
counts final SQLite busy/locked errors and render Busy answers. WAL live/backfilled frames
come from the sampler; they do not count every SQLite busy-handler retry. Complete
per-page CPU accounting remains for the full matrix.
The first bench image counts blocking queued/active jobs only around the API wrapper;
sign-in's credential/session/hash closures have separate admission and scrypt gauges.
The source now adds those closures to the blocking counters and bench-only sign-in
mutex/CPU headers. These additions pass default and bench-feature workspace checks and are built into
`snowtime-native:bench` image
`sha256:07a61ac5f7a58b2b332a3316c5f97e42af3e635d9a833d523578f518c7caaca6`.
They are measured in the corrected M one-core repeat. The
sampler now records cgroup swap, and its checked image is
`sha256:2422cf55d36c788f084c8a1adf6441529761c50544087df44bf11a3f47e1593b`.
Earlier samples lack this field and do not establish zero swap.
Default builds compile both additions out. Submitted-task counters and process thread
counts do not expose Tokio's exact internal blocking-thread count; retain the configured
maximum and label process counts accordingly. A further bench-only thread-local
guard now records live/peak blocking workers that execute DB/hash jobs and
decrements on worker retirement. It excludes workers used only for Tokio file
I/O. This counter and both maintenance fixes pass default/bench workspace
checks and both-mode conformance/byte comparisons. The next native benchmark
image is `sha256:7387139d1c5f05826689c0bcc2dfcc9a0c3a36779d1f050fdc19bb8eeee6d627`.
The first L ramp measures this image; the pool comparison remains pending.

Workspace tests with the bench feature pass after granting local listener access.
The sandbox's first attempt could not bind the TLS test sockets. Clippy with warnings
denied passes with the bench feature on the current tree. Default workspace checks,
both-mode conformance and byte comparisons, and `bun run test` pass after the admission
changes. The latest repeat also covers the blocking-worker counter and both
maintenance fixes. Repeat the required checks after any further code changes. Current verification:

- [x] Workspace clippy/tests, default and bench, after the blocking-worker counter and maintenance fixes
- [x] `conformance.ts` in both modes after maintenance fixes (13 default-suite tests each)
- [x] `compare.ts` byte equality in both modes after maintenance fixes
- [x] `bun run test` (ignore only timer-view's known near-midnight failure)
- [x] Sampler Go tests and harness lint/format checks

The rebuilt host passes the default `conformance.ts` suite and `compare.ts` in
both connection modes. A broader invocation of all seven TypeScript conformance
files also exercises unported domains: 22 pass and 21 fail, mostly with 404s.
Those routes are outside the native POC's recorded scope and the page slice;
this task does not claim full-app domain conformance. `bun run test` passes
447 Bun tests and 178 component tests on the latest repeat. The single component
failure is the user-identified “starts after today's last entry” timer-view case
near midnight, ignored as requested. The earlier component run passes all 179.

## Completed scope and follow-ups

- [x] Fix overload collection, k6 counter resets, and virtual-user ceilings
- [x] M/L replica restore verification and read-only verifier fixture
- [x] M/L one-core matched fixed loads, isolated CPU kinds, and per-call/page latency
- [x] Fresh-source single-connection M/L ramps at 1/2/4/8 cores, with prepared L
      TypeScript at eight cores; retain startup/cache/clock caveats
- [x] Reject dropped-action and generator-limited results, retain all attempts
- [x] Focused single/pool M/L at one/eight cores; retain two/four-core pool cells as deferred
- [x] Concurrent-reader worker limits, WAL/checkpoint behavior, and sampled cache costs
- [x] Provisional whole-host memory advice with startup, swap, and shared-VM limitations
- [x] Bottleneck costs and measured gains; leave unmeasured removals to follow-up profiling
- [x] Final required checks in both native modes and the TypeScript project

The dedicated-host protocol below remains unexecuted. No further optimization or
production Litestream version change belongs to this completed local measurement task.

## Repeat on Hetzner

Kait provisions a dedicated-CPU app server and a separate k6 machine on the same
network. This work provisions nothing. Follow `perf/README.md`'s remote deployment
instructions, using the same dataset files and recording from this worktree.

Set the app's cpuset and memory limit to 1/2, 2/4, 4/8, and 8/16 cores/GiB. Include
Litestream's and Caddy's memory in the host budget. Native traffic goes directly to
its TLS listener; TypeScript traffic goes through Caddy. Use [`native/bench/scaling/README.md`](../../native/bench/scaling/README.md) and its
ramp-first runner. Remote direct TLS now uses the configured native origin, with separate
sampler access through `--sampler-url`. The remote deployment/TLS/tunnel protocol has
not run here. Record generator CPU independently; the app-server sampler cannot see k6
on a separate machine.

Before each matrix cell, restore the same source dataset while app and replication
are stopped, then let replication reach steady state. Preserve the source dataset
hash, recording hash, image digest, core/memory settings, server counters, generator
CPU, and raw output. Use `--run=kinds`, matched `--run=fixed` loads, and `--run=ramp`
with the same step and hold durations. Repeat each native cell with
`DB_READ_CONNECTIONS=0` and `auto`. Deploy one Bun process for every TypeScript cell;
measure its actual multicore use rather than assuming all added cores improve it.
