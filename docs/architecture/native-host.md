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
| Database         | A gate per connection class, bounded by count and time; reports take a smaller budget before taking a database slot (081.10, 081.17)                        | Measure and tune the bounds       |
| Password hashing | Dedicated threads at lower Linux priority, with admission bounded by count and time; sized from cores and memory (081.17)                                   | Measure the sign-in burst         |
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
- **One core gains nothing from work stealing.** The smallest host has one core, where a
  multi-threaded runtime adds threads and context switches without parallelism. Task
  081.17 compares Tokio's `current_thread` runtime against the multi-threaded one there.

Rejected:

- **A thread-per-core runtime** (Glommio, Monoio) or a Tina-style framework in Rust. The
  edge depends on hyper, rustls, `axum-server`, and later quinn (task 081.09), which all
  need Tokio. Leaving Tokio means replacing that stack for no measured gain.
- **Running SQLite calls on the async workers.** Most calls take under a millisecond, but
  a report or export query would stall every connection on that worker.

The database and hash gates allow 32 waiting callers each by default
(`WORK_QUEUE_MAX_WAITING`), and wait at most 1,000 ms (`WORK_QUEUE_TIMEOUT_MS`).
An idle worker starts a call without counting it as waiting. A cancelled waiter frees
its place, and running work keeps its permits when its caller leaves. These bounds are
provisional: task 081.10 measured 117 waiting callers in a passing eight-core hold and
872 under overload, but neither run tested the count bound. Task 081.17 still needs the
measurements that set the final limits.

Reports take at most `max(1, readers / 4)` workers and allow four waiting callers, with
the same deadline. They take that budget before database admission, so waiting reports
hold no connection. The report route uses `run_report`; exports must use it when ported.
Without readers, a running report still shares the only connection with ordinary calls.
The worker share and waiting limit are provisional and await the organization-burst test.

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
lower priority. On other systems the dedicated threads keep their inherited priority.
Only database admission reaches Tokio's blocking pool, capped at readers plus one;
a source test rejects `spawn_blocking` elsewhere in the server crate.

Task 081.10's provisional whole-host test budgets are 2 GiB for M and 4 GiB for L,
including the OS, replication, and file cache. They come from a shared Mac VM and await
the dedicated-host repeat.
