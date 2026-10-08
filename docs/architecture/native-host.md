# Native host: concurrency and processes

How the native backend (task 081) schedules its work. Kait decided this on 2026-10-06,
after the overload measurements of tasks 081.03 and 081.10, a review of
[Tina](https://github.com/pmbanugo/tina) and its author's
[case against async/await for mixed network and CPU work](https://pmbanugo.me/blog/why-async-await-complect-concurrency),
and an adversarial review of this design the same day. Rendering has its own record in
[native-rendering.md](native-rendering.md). Items marked _planned_ aren't built yet;
[task 081.17](../../tasks/081-native-backend/17-bounded-lanes.md) builds them.

## Tokio at the edge, lanes behind it

Tokio's async workers run only the edge: accepting connections, HTTP/1.1 and HTTP/2, TLS,
ACME, the edge middleware, and the async parts of Axum's handlers. Work that blocks or
burns CPU goes to a _lane_ instead: a fixed number of workers for one resource, behind
admission that refuses when the lane is full.

Every lane keeps the same contract:

- **A fixed number of workers.** Nothing grows with load: not threads, not processes, not
  connections. A replacement worker that starts before the old one retires counts against
  the lane's memory budget, and the host reserves room for it first.
- **Admission per scarce resource.** A caller waits for the resource it will use, not for
  a share of a pool that holds several. With the read pool on, reads wait for a reader
  and writes for the writer, so slow writes can't keep reads from idle readers.
- **Bounded waiting, by count and by time.** A caller waits only while fewer than the
  lane's maximum are already waiting, and only until the lane's deadline, which the
  caller's side enforces. Past either bound the host answers at once with 503 and
  `Retry-After`, or 429 where a per-caller limit applies.
- **No work for callers that left.** A caller dropped while waiting leaves the queue, and
  its job never runs. Cancelling a page cancels the API calls it has queued. Work that
  already runs keeps its permit until it finishes.
- **A restart budget for lasting workers.** A lane whose workers outlive a job (a renderer,
  an owner thread) restarts a worker that exits or panics, and keeps its worker count
  correct when one dies. Past N restarts in T seconds it stops restarting and is marked
  down, so a crash loop can't take the core. Planned recycles don't count.

A lane can implement this in two ways. Task 081.10 built the first: a semaphore taken
asynchronously before `spawn_blocking`, with Tokio's blocking threads capped at the sum of
the lanes' limits. The other is a dedicated thread or process fed by a bounded channel,
as the V8 renderers are. The contract matters more than the mechanism. A lane gets its
own threads where the shared pool can't keep the contract: password hashing, whose lower
priority must not carry over to database work on a reused thread.

| Lane             | Built                                                                                                                                                       | _Planned_                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Database         | A gate per connection class, bounded by count and time; reports take a smaller budget before taking a database slot (081.10, 081.17)                        | Validate capacity and overload    |
| Password hashing | Dedicated threads at lower Linux priority, with admission bounded by count and time; sized from cores and memory (081.17)                                   | None                              |
| Rendering        | V8: a bounded queue, the deadline on the caller's side, cancelled pages withdrawn with their API calls, a supervisor, and a restart budget (081.01, 081.17) | Bun: the sidecar, parked (081.16) |

A reader that finds a session due for renewal or expired takes the writer only if the
writer's gate has a free slot at that moment. Otherwise it answers from the reader, and a
later request renews or deletes the session. A session due for renewal stays valid for
about 29 more days, and an expired one is refused either way, so a busy writer never
holds up a read.

The V8 restart budget counts only renderer threads that panic. An isolate replaced after
a failed render or for its heap doesn't count, so one page that fails every time can't
take the lane down.

Reasons:

- **Memory stays bounded under overload.** Before admission, task 081.10's 40,000-user
  overload run with replication reached 525 threads, 518 blocking calls in flight, and
  364 MB app RSS. With admission the same load held 9 threads and 205 MB (184 MB without
  replication). Waiting was bounded only by time, and 872 callers waited at its peak; 117
  waited in an eight-core hold that passed. A time bound limits how long a caller waits,
  not how many arrive in that time, and each holds its request body (up to 2 MiB) and
  its future. A count bound caps both.
- **CPU work can't stall everything else.** Sign-in's scrypt took 113 ms on the one core
  and raised the slice's return p95 to 84–126 ms (task 081.03). AWS-LC cut that to
  24–29 ms (task 081.08), but a burst of sign-ins still competes with every request.
  Each hash also holds a 32 MiB buffer, so the hash lane's size follows memory as well as
  cores. Task 081.10's eight-core holds peaked at three hashes at once.
- **The one-core runtime comparison is inconclusive.** The valid 5,000-user pair
  favors `current_thread` on CPU, p95, and thread count. One pair without repeats does
  not establish a default; keep `multi_thread` unchanged. The failed 15,000-user
  phases cannot select the runtime.

Rejected:

- **A thread-per-core runtime** (Glommio, Monoio) or a Tina-style framework in Rust. The
  edge depends on hyper, rustls, `axum-server`, and later quinn (task 081.09), which all
  need Tokio. Leaving Tokio means replacing that stack for no measured gain.
- **Running SQLite calls on the async workers.** Most calls take under a millisecond, but
  a report or export query would stall every connection on that worker.

The database and hash gates allow 4,096 waiting callers each by default
(`WORK_QUEUE_MAX_WAITING`), and wait at most 1,000 ms (`WORK_QUEUE_TIMEOUT_MS`).
The count is a memory backstop; the deadline bounds ordinary admission. An idle
worker starts a call without counting it as waiting. A cancelled waiter frees its
place, and running work keeps its permits when its caller leaves. The queue-sizing
measurement and memory estimate are recorded below. Both settings stay configurable.

Reports take at most `max(1, readers / 4)` workers and allow four waiting callers. They
take that budget before database admission, so waiting reports hold no connection, and
both waits share one deadline, so a report is admitted or refused within it. Every report read uses `run_report`, including exports ported in task 081.24.
Without readers, a running report still shares the only connection with ordinary calls.
The worker share and waiting limit follow the burst measurements below.

## Burst measurements, 2026-10-07

Keep the report budget at `max(1, readers / 4)` workers and four waiting callers. With
8 readers it leaves 6 readers available to ordinary calls. A full-year report burst
from one organization reduces other organizations' timer-read p95 from 1,005 ms to
2.8 ms, with no timer-read refusals in the bounded run. With only one database
connection, a running report still delays ordinary calls and a few timers refuse.
These measurements do not require a per-organization limit.

The M source contains 1,192,801 entries, 63 organizations, and 1,049 seeded sessions.
The source date is 2026-10-04; sessions are renewal-eligible. Every cell restores the
same source. `9adb20e` supplies the before host, with split database gates but no
waiting-count bound, report budget, or dedicated hash workers. The after host uses
`ea67d42`'s lane code, a runtime selector, and a report-budget counter. Both images use
the same render bundle. The native TLS edge serves gzip directly, with no replication.
The Docker VM has 10 vCPUs and 8.57 GB RAM. The app gets core 1 or cores 0–7;
k6 gets cores 2–9 or 8–9. These are single observations on a shared Mac VM.
The 8-core app cap is 15,872 MiB, above the VM's RAM; the shared-memory guard remains
active. This tests lane contention, not a deployable memory allocation for that VM.

The runner is task 081.10's `perf/stress/stress.ts`, with overlapping `--plan` scenarios.
Steady traffic represents 5,000 active users and excludes the bursting organization.
The report burst offers 200 full-year reports a second for 30 seconds, from the owner
of `bench-1` (188 current members). It requests 2025-10-01 through 2026-10-05 in weeks.
All eight final report cells have zero dropped actions and generator headroom. The
initial 150-VU pilot dropped 56 actions; the final cells preallocate 250 VUs. Validation
checks the global dropped counter as well as scenario counters, because k6's dropped
iterations do not carry the custom step tag.

Timer p95 below is k6's duration for `GET /api/v1/timer` during return actions, in ms.
Refusals count all timer reads during that phase. Report refusals all carry
`Retry-After: 1`. Their server-side p95 is 0.062–0.073 ms after the change, against
1,002–1,004 ms before it. The sampled report queue never exceeds four; the before
read/write queues peak at 307–328. These bursts use the original 32-caller bound and 1,000-ms deadline. The queue
sizing review below replaces that count bound.

| Cores / readers | Timer p95 before | After | Timer 503s before |    After | Report 503s after |
| --------------- | ---------------: | ----: | ----------------: | -------: | ----------------: |
| 1 / 0           |           1007.9 | 146.1 |         637 / 648 |  3 / 643 |       5776 / 6000 |
| 1 / 1           |           1009.3 | 139.7 |         635 / 644 | 10 / 631 |       5775 / 6001 |
| 8 / 0           |           1002.5 | 110.7 |         616 / 631 |  2 / 625 |       5738 / 6000 |
| 8 / 8           |           1004.8 |   2.8 |         592 / 629 |  0 / 631 |       5501 / 6001 |

The sign-in burst is configured at 10 sign-ins a second for 10 seconds. k6 completes
100–101 sign-ins per cell, all with 200, with no dropped actions or other request
errors during the burst. The table records server access-log p95 for the other request
kinds, in ms; timer reads use the k6 measure above. `start` includes the mutation and
its subsequent reads. Rare report kinds have too few samples for a gain claim; their
counts and p95 remain in the evidence. The one-core changes are small, and these
single runs do not establish a material latency gain from the dedicated workers.

| Cores / readers | Host   | Sign-ins | Timer read | Return API | Start API | Edit API | Open page |
| --------------- | ------ | -------: | ---------: | ---------: | --------: | -------: | --------: |
| 1 / 0           | Before |      100 |       18.4 |       18.2 |      10.4 |     10.1 |      70.9 |
| 1 / 0           | After  |      101 |       17.4 |       16.1 |      10.1 |      8.0 |      42.3 |
| 1 / 1           | Before |      101 |       20.0 |       19.9 |      13.3 |     17.9 |      75.6 |
| 1 / 1           | After  |      101 |       16.8 |       16.3 |      10.0 |      9.3 |      50.7 |
| 8 / 0           | Before |      100 |        6.4 |        6.0 |       2.0 |      1.8 |      27.8 |
| 8 / 0           | After  |      101 |        5.7 |        5.5 |       2.4 |      1.8 |      36.5 |
| 8 / 8           | Before |      101 |        1.5 |        3.2 |       2.1 |      1.8 |      28.8 |
| 8 / 8           | After  |      101 |        1.1 |        3.3 |       1.9 |      1.8 |      32.1 |

Input hashes, image IDs, per-kind counts, timer-call timings, 503 timings, queue peaks,
and generator checks are recorded in
[bursts.json](../../tasks/081-native-backend/lane-measurements/bursts.json).
Raw requests, samples, k6 summaries, settings, commands, and logs remain in the
`081-lanes` worktree's `perf/.cache/stress/runs/*08117*` and `perf/.cache/stress/08117/`.
Capacity and overload results are recorded below; the remaining matrix is task 081.27.

## One-core runtime measurement, 2026-10-07

The comparison is inconclusive, and the `multi_thread` default stays unchanged.
The valid 5,000-user phase favors `current_thread` on every recorded metric: 7% less
CPU per HTTP attempt, lower timer, return, and page p95, and one fewer thread.
One pair with a random action mix needs repeats before changing the default. Both
15,000-user phases fail the error target, so their latency and CPU figures do not
select the runtime. `TOKIO_RUNTIME=current_thread` keeps the alternative available.

Each runtime uses the same after image and M source, with no readers on core 1.
A 30-second, 5,000-user warmup precedes two 120-second offers. Both runs have zero
dropped actions and generator headroom. Both 5,000-user phases meet the targets;
15,000 users miss the error target (0.51% and 0.61%), so neither is a capacity hold.
CPU is the mixed process cost per HTTP attempt, including the native TLS edge and
refusals. Timer p95 uses the k6 measure above; return and page p95 use server logs.
Latency columns are milliseconds. These observations need a repeat before a causal
CPU claim, particularly at the higher offer with differing refusals.

| Runtime          | Users | CPU ms / HTTP | Timer p95 | Return API p95 | Open page p95 | 503s / HTTP | Peak threads |
| ---------------- | ----: | ------------: | --------: | -------------: | ------------: | ----------: | -----------: |
| `multi_thread`   |  5000 |          1.79 |      11.0 |           14.9 |          57.0 |   0 / 12361 |            9 |
| `multi_thread`   | 15000 |          1.20 |      14.7 |           17.1 |          49.1 | 191 / 37234 |            9 |
| `current_thread` |  5000 |          1.66 |       6.5 |           14.1 |          45.8 |   0 / 12502 |            8 |
| `current_thread` | 15000 |          1.18 |      12.1 |           19.9 |          61.1 | 228 / 37250 |            8 |

[Runtime evidence](../../tasks/081-native-backend/lane-measurements/runtime.json) retains
counts, timings, counters, samples' process summaries, and the raw result locations.
The queue decision is recorded below. Task 081.27 holds the remaining capacity and overload runs.

## Overload policy

Kait, 2026-10-06: when a server shared by many companies is overloaded, ordinary timer
reads and writes keep working, and reports and exports refuse first. Reports and exports
get a smaller admission budget inside the database lane, and an export can't hold more
than its share of workers. Limits per company or per user come only if a measurement
shows one tenant crowding out the others.

The client keeps a refused edit: it stays pending with a retry action instead of rolling
back, and nothing retries a write on its own. Reads retry with jitter and wait at least
the `Retry-After` the server sent ("Application rules" in [README.md](README.md)).

## Health

Liveness fails only when the host can't serve the API. Readiness reports each lane:
ready, degraded, or down. The host answers `/livez` with 200, or 503 when the database
check fails, and `/readyz` with each lane's state as JSON. A database lane that refuses
the check for being full counts as degraded, not down. A render lane past its restart
budget serves pages from V8 if the image includes it, which is degraded, or answers 503
for pages while the API keeps working. An orchestrator therefore doesn't restart a host whose API is healthy, which
would also reset the budget.

## Rules stay synchronous and free of I/O

A rule takes `(db, scope, input)` and returns `Result<T>` (task 081.03). It reads the time
from `clock::now()` and reaches the database only through the connection it's given.
Lanes are the only place the host runs work on other threads. This keeps the rules
testable without a server and leaves room for a deterministic simulation that replays
lane order from a seed, injects slow or failed calls, and checks the conformance suite
under it. The simulation isn't planned yet.

## Sizing

The host sizes each lane from the memory it may use (the cgroup's limit or physical
memory) and its CPUs, as it already sizes the render pool (task 081.01). On one core each
lane gets one worker, except the renderers, whose count comes from task 081.16's
measurements. The host opens a reader per core when it has more than one core, and none
on one core (`DB_READ_CONNECTIONS=auto`, the default since 2026-10-06). The read pool
raised the held eight-core offer 1.3 times on M and 6 times on L, but one reader on one
core held 15,000 users on M against 25,000 with the single connection (task 081.10).
Those runs predate the gate per connection class, and task 081.17's measurements repeat
them. Budget at least 2 MiB of page cache per reader plus its statements.

Password workers use the smaller of the core count and one eighth of the memory limit
at 32 MiB per hash, with at least one worker. `SCRYPT_CONCURRENCY` can reduce that cap.
This share fits inside the render policy's 25% headroom and still needs measurement.
On Linux each dedicated thread increases its inherited niceness by five, capped at 19,
and verifies the new value before accepting work. Startup fails if a thread cannot get a
lower priority, except on a host already at 19, which has no lower one. On other systems the dedicated threads keep their inherited priority.
Only database admission reaches Tokio's blocking pool, capped at readers plus one;
a source test rejects `spawn_blocking` elsewhere in the server crate.

Task 081.10's provisional whole-host test budgets are 2 GiB for M and 4 GiB for L,
including the OS, replication, and file cache. They come from a shared Mac VM and await
the dedicated-host repeat.

## Capacity and overload measurements, 2026-10-07

The original 32-waiter limit caps the sampled database queues at 32,
but the measured capacity falls and the overload RSS requirement fails. These runs
do not establish a final count bound or a new deadline. The later queue-sizing review
replaces both 32 and 128 with a 4,096-waiter backstop. The 1,000-ms deadline stays
configurable; the bounded runs mostly refuse because the queue is full before that
deadline expires.

Each cell restores the same M source and render bundle as the burst runs, uses
Tokio's multi-threaded runtime, ramps in 60-second steps, and holds a passing offer
for 120 seconds. The same warm process then receives twice and four times that
offer for 60 seconds each, followed by 120 seconds at the held offer. Capacity means
passing that hold's latency, error, and generator checks. It is one observation per
cell, without repeats.

| App cores / readers | Before held users | After held users |
| ------------------- | ----------------: | ---------------: |
| 1 / 0               |            20,000 |            8,000 |
| 1 / 1               |            30,000 |           10,000 |
| 8 / 0               |            40,000 |           12,500 |
| 8 / 8               |            80,000 |           65,000 |

The comparison changes the queue bound, report budget, and hash workers together.
It shows a regression with those settings; it does not isolate which setting causes
it. The queue-sizing review below replaces the 32-waiter default with 4,096.

Three after cells complete overload and recovery with zero dropped actions and
adequate generator headroom. None meets the RSS limit:

| App cores / readers | RSS at held capacity (MB) | Peak overload RSS (MB) | Growth | 4x offer: 503 / 500 |
| ------------------- | ------------------------: | ---------------------: | -----: | ------------------: |
| 1 / 0               |                     248.8 |                  343.4 |    38% |           3,253 / 9 |
| 1 / 1               |                     251.4 |                  366.3 |    46% |          4,694 / 39 |
| 8 / 0               |                     355.2 |                  859.9 |   142% |          6,004 / 56 |

RSS is sampled process resident memory in decimal MB. It excludes the database's
page cache counted in cgroup memory. A bound on database waiters does not by itself
keep total app RSS within 10%. Most excess requests receive 503, but the 500 responses
also leave the refusal requirement open.

Both eight-reader overload plans exceed the generator's CPU guard and abort. They
also drop actions: 3,403 before and 249 after. Their 2x/4x figures and recovery phases
are invalid and cannot establish an RSS or refusal result. The before eight-core,
zero-reader overload plan drops 87 actions; its passing capacity hold remains usable,
but its combined overload and recovery plan is invalid. These are generator limits,
not evidence of a server capacity or memory limit.

The Docker VM has ten CPUs and 8.57 GB RAM. The eight-core app leaves two separate
cores for k6; its configured 15,872 MiB container limit exceeds the VM's physical RAM.
The shared-host memory guard remains enabled. A valid eight-reader overload run
needs more generator headroom or lower-cost instrumentation with equivalent checks.

[Structured ramp evidence](../../tasks/081-native-backend/lane-measurements/ramp.json)
records the capacities, per-step validity, status counts, timings, sampled RSS, queue
peaks, image IDs, and input hashes. Task 081.27 holds the remaining valid overload and capacity matrix. The later
sections record the memory criterion, queue choice, and tested refusal fix.

## Overload memory criterion, 2026-10-08

Record RSS at held capacity, twice and four times that offer, and recovery.
Peak RSS must fit task 081.10's provisional whole-host budget: 2 GiB for M.
Require no OOM kill or swap, queues within their bounds, admission refusals as 503
with `Retry-After`, and a recovery hold that passes the normal latency and error
targets. A judged phase needs generator headroom and no dropped actions.

Kait agrees to drop the flat 10% RSS rule. Task 081.10's whole-host budget includes
OS, replication, and filesystem cache; app RSS alone cannot validate a standalone
2-GiB deployment. The shared-host 85% guard remains a harness safety stop and is not
an acceptance budget. Task 081.27 carries the remaining overload measurements under
this criterion, including a valid eight-reader run with enough generator headroom.

The page handler propagates an in-process API's 503 and `Retry-After`, including when
the rendering framework catches the dependency error and emits a 500 or partial page.
A completed render is discarded on refusal but keeps its warm isolate. Only a failed
render resets it. Tests verify the retry header at the page handler, isolate reuse
following a completed refusal, and reset following a thrown render error.

## Larger-bound capacity trial, 2026-10-08

A single eight-core, eight-reader run at 128 waiting callers warms at 40,000 users
for 30 seconds and holds 80,000 users for 120 seconds. It uses the same M source and
recording as the ramp, with the page-refusal fix included. The generator drops no
actions and has headroom. Every latency target passes, but 452 of 198,970 logged
requests return 503 (0.23%), above the 0.1% error target. All 452 carry `Retry-After`;
none returns 500. The 27 stop-timer 404s are expected under concurrent actions.

The 32-waiter hold at this offer had 882 server errors (0.44%). The larger-bound trial
reduces refusals but does not confirm 80,000-user capacity. Its sampled read queue
peaks at 89 and writer queue at four; one-second samples can miss the instantaneous
queue peak. Peak hold RSS is 1,134 MB, with no observed app swap or OOM kill.
The queue-sizing review below rejects 128 as an ordinary admission limit. This
trial does not confirm 80,000-user capacity. Its image also resets the isolate on
every API refusal; the reviewed implementation keeps completed renders warm.

[Trial evidence](../../tasks/081-native-backend/lane-measurements/confirm-128.json),
[raw k6 summary](../../tasks/081-native-backend/lane-measurements/confirm-128-k6-summary.json),
and [runner output](../../tasks/081-native-backend/lane-measurements/confirm-128.log)
retain the observations. [Native test output](../../tasks/081-native-backend/lane-measurements/native-tests.log)
records 14 host, eight renderer, and 36 server tests passing, including API-refusal
propagation through a rendered page.

## Queue sizing and one-core confirmation, 2026-10-08

Use a 4,096-waiter backstop and retain the 1,000-ms deadline. At eight readers and
80,000 users, the host handles about 1,650 HTTP calls/s: throughput times the deadline
is about 1,650 outstanding callers. At one core and 20,000 users, the before host
handles about 415 calls/s, giving about 415 callers. Database operations per HTTP
call and page fan-out differ, so this is a sizing estimate, not a per-gate arrival
measurement. Allow twice the larger estimate for fan-out and sub-second spikes,
then round up to 4,096. The deadline still bounds each wait to one second; the count
is an emergency memory backstop rather than the ordinary admission cutoff.

The 32-waiter eight-reader hold refuses 872 calls, all in under 10 ms. The
128-waiter hold refuses 452, of which 449 finish in under 10 ms. None waits near
1,000 ms. Those count limits cut off work before the deadline; one-second sampled
queue peaks miss the sub-second spikes. The 4,096 choice follows that observation
and the throughput calculation, rather than another 256-waiter comparison.

Budget a typical waiting request at 32 KiB for task/future state, headers, ordinary
small inputs, and allocator overhead. This planning estimate is 128 MiB per gate,
or 384 MiB if the reader, writer, and hash gates all fill. It is not a measured
allocation or an enforced per-request byte limit. Large request bodies, running
scrypt buffers, renderer heaps, and filesystem cache need their own allowance in
the provisional 2-GiB whole-host M budget. Task 081.27 validates overload memory;
the count alone does not prove that budget.

The requested one-core, zero-reader confirmation warms at 10,000 users for 30 seconds
and holds 20,000 for 120 seconds. It completes 49,716 logged requests, all 200,
with zero dropped actions, generator headroom, and all 30-second latency windows
within target. Return API server p95 is 70 ms; open-page p95 is 145 ms. Peak app RSS
is 336 MB, with no OOM kill or observed app swap. This restores the before host's
20,000-user hold, against 8,000 with the original 32-waiter settings. It establishes
that held offer, not the maximum capacity or the four-configuration capacity matrix.

The Mac wakes at 08:56 Tallinn time before the 09:04–09:07 measurement. The largest
sampler gap is 1.008 seconds, so the user's sleep/move does not interrupt this run.
Both the larger backstop and renderer-reuse fix are in the image; this confirmation
does not isolate their contributions.

[Confirmation evidence](../../tasks/081-native-backend/lane-measurements/confirm-4096.json),
[raw k6 summary](../../tasks/081-native-backend/lane-measurements/confirm-4096-k6-summary.json),
and [runner output](../../tasks/081-native-backend/lane-measurements/confirm-4096.log)
retain the result, input references, image IDs, source hashes, and timing continuity.
[Review test output](../../tasks/081-native-backend/lane-measurements/review-native-tests.log)
records 59 passing native tests, including completed-render reuse after API refusal.
