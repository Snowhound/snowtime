# Native host: concurrency and processes

How the native backend (task 081) schedules its work. Kait decided this on 2026-10-06,
after the overload measurements of tasks 081.03 and 081.10, and a review of
[Tina](https://github.com/pmbanugo/tina) and its author's
[case against async/await for mixed network and CPU work](https://pmbanugo.me/blog/why-async-await-complect-concurrency).
Rendering has its own record in [native-rendering.md](native-rendering.md). Items marked
_planned_ aren't built yet;
[task 081.17](../../tasks/081-native-backend/17-bounded-lanes.md) builds them.

## Tokio at the edge, lanes behind it

Tokio's async workers run only the edge: accepting connections, HTTP/1.1 and HTTP/2, TLS,
ACME, the edge middleware, and the async parts of Axum's handlers. Work that blocks or
burns CPU goes to a _lane_ instead: a fixed number of workers for one resource, behind
admission that refuses when the lane is full.

Every lane keeps the same contract:

- **A fixed number of workers.** Nothing grows with load: not threads, not processes, not
  connections.
- **Bounded waiting, by count and by time.** A caller waits for a worker only while fewer
  than the lane's maximum are already waiting, and only until the lane's deadline. Past
  either bound the host answers at once with 503 and `Retry-After`, or 429 where a
  per-caller limit applies.
- **No work for callers that left.** A caller dropped while waiting leaves the queue, and
  its job never runs.
- **A restart budget for lasting workers.** A lane whose workers outlive a job (a renderer,
  an owner thread) restarts a worker that exits or panics. Past N restarts in T seconds it
  stops restarting and is marked down, so a crash loop can't take the core. The health
  check fails when a lane the app needs is down.

A lane can implement this in two ways. Task 081.10 built the first: a semaphore taken
asynchronously before `spawn_blocking`, with Tokio's blocking threads capped at the sum of
the lanes' limits. The other is an owner thread fed by a bounded channel, as the V8
renderers are. The contract matters more than the mechanism; task 081.17 changes a lane
to an owner thread only where a measurement shows a gain.

| Lane             | Workers                                                | Status                                                                                                          |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Database         | `DB_CONCURRENCY` calls: the writer and readers on WAL  | Built in task 081.10 (not yet merged), bounded by time only; the count bound is _planned_                       |
| Password hashing | `SCRYPT_CONCURRENCY` hashes                            | Built in task 081.10 (not yet merged), sized from cores only; sizing from memory and a lower priority _planned_ |
| Rendering        | The render pool: V8 threads, or Bun processes (081.16) | V8 conforms; the Bun sidecar is _planned_                                                                       |

Reasons:

- **Memory stays bounded under overload.** Before admission, task 081.10's 40,000-user
  overload run reached 525 threads, 518 blocking calls in flight, and 364 MB app RSS.
  With admission the same run held 9 threads and 184 MB. Waiting was still bounded only
  by time, and 872 callers waited at the peak; their futures and requests use memory too,
  which is why waiting is bounded by count as well.
- **CPU work can't stall everything else.** Sign-in's scrypt took 113 ms on the one core
  and raised the slice's return p95 to 84–126 ms (task 081.03). AWS-LC cut that to
  24–29 ms (task 081.08), but a burst of sign-ins still competes with every request.
  Each hash also holds a 32 MiB buffer, so the hash lane's size follows memory as well as
  cores.
- **One core gains nothing from work stealing.** The target host has one core, where a
  multi-threaded runtime adds threads and context switches without parallelism. Task
  081.17 compares Tokio's `current_thread` runtime against the multi-threaded one there.

Rejected:

- **A thread-per-core runtime** (Glommio, Monoio) or a Tina-style framework in Rust. The
  edge depends on hyper, rustls, `axum-server`, and later quinn (task 081.09), which all
  need Tokio. Leaving Tokio means writing that stack ourselves for no gain on one core.
- **Running SQLite calls on the async workers.** Most calls take under a millisecond, but
  a report or export query would stall every connection on that worker.

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
lane gets one worker, except where its work waits on something other than the CPU: the
database lane's readers, and the renderers, whose count comes from task 081.16's
measurements. On four and eight cores, task 081.10 measured the app using about 1.1
cores while latency failed, with database work the candidate bottleneck; the read pool's
default awaits its measurements.
