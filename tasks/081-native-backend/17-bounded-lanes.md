# 081.17: The lane contract, the overload policy, and refusal in the client

Status: done

Bring the database, password hashing, and V8 render lanes up to the contract in
[native-host.md](../../docs/architecture/native-host.md), and build the overload policy
and the client's handling of refusal that Kait chose on 2026-10-06. Subtask 10's gates
(`native/crates/server/src/admission.rs`) cap blocking threads and refuse after
`WORK_QUEUE_TIMEOUT_MS`. They admit reads and writes through one gate, bound waiting by
time only (117 callers waited in a passing eight-core hold), and share Tokio's blocking
pool with hashing. The V8 pool checks its queue deadline only at dequeue and has no
supervisor. A 503 rolls back the user's edit (`src/lib/queries/query.ts`) and loses
`Retry-After` (`src/lib/api/request.ts`).

The client changes serve both backends, so they land on `main` in their own branch; the
rest stays on the native branches. Measure with subtask 10's runner, M first, at one and
eight cores, with and without the read pool.

## Acceptance criteria

Database and hashing:

- [x] One gate per connection class: reads wait for a reader and writes for the writer
      when the read pool is on. A test with a deliberately slow writer shows reads
      continuing on idle readers, and one with slow readers shows a timer write going
      through. Session maintenance from a reader takes the writer only when its gate has
      a free slot, and never waits for it
- [x] Each gate refuses at once, with 503 and `Retry-After`, when its waiting callers reach
      a maximum, with a test; the maximum and the deadline recorded in native-host.md with
      the measurement that set them
- [x] Reports and exports admitted through a smaller budget inside the database lane. With
      one organization bursting reports, other organizations' timer p95 and refusals
      measured before and after
- [x] Password hashing on dedicated threads below the other lanes' OS priority, sized from
      memory (32 MiB a hash) as well as cores; `spawn_blocking` reached only through a
      gate, checked by a test or a lint
- [x] A fixed load with a burst of sign-ins (10 a second for 10 seconds) before and after:
      the p95 of the other request kinds during the burst
- [x] One capacity confirmation on M at 1 core / 0 readers with the selected
      backstop, recording the held offer, refusal status, latency, RSS, and generator
      validity. The full capacity matrix and overload comparison moved to
      [081.26](26-capacity-overload.md); they do not block this task's merge

Rendering (V8):

- [x] The queue deadline enforced on the caller's side: a page queued behind a stuck render
      is refused near `max_queue_wait`, not after the render deadline, with a test
- [x] A cancelled page leaves the queue at once, and cancelling or timing out a page aborts
      the API calls it has queued on the host's runtime, with tests
- [x] A supervisor restarts a renderer thread that panics, keeps the renderer count
      correct, and answers its queued callers; a restart budget, with planned isolate
      replacements not counted, marks the render lane down, with tests

Host and client:

- [x] Liveness and readiness as in "Health" in native-host.md, with a test where the render
      lane is down and the API still serves
- [x] Tokio's `current_thread` runtime compared with the multi-threaded one on one core,
      with CPU per request and p95, and the choice recorded in native-host.md
- [x] The client keeps `Retry-After` on a refused call. A write refused with 503 keeps its
      optimistic change, pending with a retry action, and nothing retries it on its own.
      Reads retry with jitter, waiting at least `Retry-After`. A test injects 503s into an
      edit and the queries it invalidates, and counts the attempts
- [x] The decisions catalogue in task 081.05 updated with the results

## Progress, 2026-10-06

Branch `081-lanes` (off `081-native-poc`) built the five ticked criteria, with code and
tests only; nothing was measured.

- Database: the writer's gate has one slot, so single-connection mode admits one call
  at a time where `DB_CONCURRENCY` admitted two. `DB_CONCURRENCY` is gone, and the
  blocking thread cap is the readers plus one plus `SCRYPT_CONCURRENCY`. The M and L
  repeats must check that the single-connection offer holds. Kait chose on 2026-10-06
  that a reader renewing or deleting a session takes the writer only if its gate is free
  at once, and otherwise leaves it to a later request. Renewals cluster at the start of
  the working day, when the writer is busiest, and waiting for it held readers idle.
- Rendering: the pool keeps its own queue, so a caller withdraws its page on timeout or
  drop. The restart budget defaults to 5 panics in 60 seconds (`Policy`), unmeasured.
- Health: `/livez` and `/readyz` on the host, outside `/api/v1`.
- Readers: Kait made `DB_READ_CONNECTIONS=auto` the default on 2026-10-06, and `auto` now
  opens no readers on one core and one per core above that. The measurements here
  should confirm both with the split gates.

Left for later sessions: the waiting-count bound, dedicated hash threads, the
report/export budget, the runtime comparison, the measurements, and the client's refusal
handling.

## Progress, 2026-10-07

Merged `081-native-poc` into `081-lanes` by fast-forward before editing. Its task 081.22
bundle and V8 engine decision are included.

- Gates now cap waiting callers at 32 (`WORK_QUEUE_MAX_WAITING`) and refuse at once with
  503 and `Retry-After: 1` when full. Cancellation releases a waiting place. The existing
  1,000 ms deadline remains configurable. Both bounds are provisional and unmeasured.
- Reports take a separate budget before database admission: `max(1, readers / 4)` active
  calls and four waiters. Tests cover an ordinary read while a report waits, refusal at
  the report route, and ordinary reads and writes while a report runs. A cancelled caller
  keeps both permits until the report finishes. Exports are still unported and must use
  `run_report` when added.
- Hashes run on dedicated threads. On Linux workers apply and verify niceness five above
  their inherited value. A test reads both workers' actual priority and checks that the
  edge and database threads retain theirs. The host caps hashes by cores and one eighth
  of the memory limit at 32 MiB a hash; `SCRYPT_CONCURRENCY` can only reduce that cap.
  Tokio's blocking thread cap is now readers plus one. A source test enforces the single
  gated `spawn_blocking` entry point.
- Validation: the final 35 server unit tests passed on macOS with `bench` enabled. An
  earlier 35-test Linux run passed, including the actual priority test, with `bench`
  enabled. The Linux Docker build's final image export was cancelled after the tests passed when Kait checked CPU use. No load tests
  or render benchmarks ran. Hash sizing assertions passed in the server suite; the host
  suite is deferred to avoid another large build during the other session's measurements.

- Client: branch `081-client-refusal`, separate from the native branch, reviewed and
  merged into `main` on 2026-10-07 as `a967782`..`74e1ba4`. Kait approved reusing Alert and the “Try again” button.
  The API preserves `Retry-After`, including non-JSON edge refusals. A refused optimistic
  write stays pending, and only that button sends its original variables again. The
  shared helper prevents automatic mutation retries and re-applies pending changes after
  independent reads. Timer timestamps stay fixed while pending. Signing out or changing
  users clears pending changes and disables their old retry actions.
- Reads retry up to three times with jitter, waiting at least `Retry-After` in seconds or
  HTTP-date form. The injection test counts one refused write during a simulated minute,
  one write on “Try again”, and two attempts for each invalidated read, with the retry
  delayed by the header plus jitter. Further tests cover repeated refusal, rollback after
  a permanent error, newly loaded caches, frozen timer timestamps, and changing users.
- Client validation: the initial four targeted suites passed 58 tests; the final two
  changed suites passed nine tests. The five API request tests, TypeScript, icon check,
  lint, formatting, and knip passed. `main` remains at `4783c27` and was never edited.

The queue-bound and report criteria stay unticked because each also requires
measurements. The runtime comparison, sign-in burst, overload ramp, and decisions
catalogue results remain pending.

## Review fixes, 2026-10-07

- A report's two waits, for the report budget and then a database slot, share one
  deadline instead of taking one each; a test covers two gates passed in turn.
- A host already at niceness 19 starts, since its hash threads can't go lower.
- The server crate's 37 tests pass on Linux in `rust:1.99-trixie`, including the priority
  test, and on macOS with and without `bench`; the host's tests pass on macOS.
- The client branch now holds a write made while one is pending and sends them in order,
  shows the pending message only for kept writes, skips query retries in server renders,
  and shows pending changes in an orange alert, in their rows, and in the calendar's
  status line. Rebased onto `main`, it is `a967782`..`74e1ba4` there.

## Burst measurements, 2026-10-07

The sign-in and organization-report measurements pass the generator checks at one and
eight assigned cores, with zero and one/eight readers. Each restores the same M source.
The report budget keeps the eight-reader timer p95 at 2.8 ms during 200 full-year
report attempts a second, with zero timer-read refusals. Single-connection and
one-reader modes still have a few timer-read refusals. The 10/s, 10-second sign-in
bursts complete 100–101 sign-ins each without errors.

[Native host measurements](../../docs/architecture/native-host.md#burst-measurements-2026-10-07)
record the tables and limits of these observations. The structured
[burst evidence](lane-measurements/bursts.json) retains counts, timings, queue peaks,
input hashes, and image IDs. Raw evidence remains in `perf/.cache/stress/` in this
worktree. A dropped-action pilot is excluded; the runner now checks k6's global and
scenario dropped counters rather than relying on the custom step tag.

The one-core runtime pair completes without dropped actions. The comparison is inconclusive: the valid 5,000-user pair favors `current_thread`
on all recorded metrics, but lacks repeats. Keep the default unchanged. Both
15,000-user phases miss the error target and do not select the runtime.
[Runtime evidence](lane-measurements/runtime.json) records the observations.

## Capacity and overload results, 2026-10-08

The matrix finished on 2026-10-07 at 20:34 Tallinn time. The benchmark is stopped.
[Native host results](../../docs/architecture/native-host.md#capacity-and-overload-measurements-2026-10-07)
and [ramp evidence](lane-measurements/ramp.json) record the findings.

The after database queues stay at or below 32, but the provisional settings reduce
held capacity in all four configurations. The three valid after overload plans grow
RSS by 38%, 46%, and 142%, above the 10% limit. Excess requests mostly return 503;
some return 500. The two eight-reader overload plans hit the generator CPU guard and
drop actions, so their overload and recovery results are invalid.

The broader capacity and overload measurements moved to task 081.26 after review.
The one-core confirmation below passes and the remaining runs do not block merging
this task into `081-native-poc`.

## Agreed review, 2026-10-08

A completed page with an API refusal keeps its isolate; a thrown render resets it.
The renderer-reuse regression test verifies both paths, and the page-handler test
retains the original retry interval and `Cache-Control: no-store`.

The selected 4,096-waiter backstop follows measured throughput times the one-second
deadline, with room for fan-out and sub-second spikes. The 32/128 limits refuse
instantly rather than at that deadline. Native host records the calculation and
waiter memory estimate. No 256 comparison runs.

Kait agrees to drop the 10% RSS rule. The criterion now records RSS at capacity, 2x,
4x, and recovery against task 10's provisional 2-GiB whole-host budget for M, with
no OOM or swap, bounded queues, 503 admission refusals with `Retry-After`, and passing
recovery. The shared-host 85% safety stop is not a budget. The four-configuration
capacity rerun and valid eight-reader overload comparison are in
[081.26](26-capacity-overload.md), which does not block the merge.

The runtime comparison is inconclusive; the valid 5,000-user pair favors
`current_thread`, but one pair cannot change the default. The failed 15,000-user
phases do not select it. Keep `multi_thread` unchanged. Docker cache cleaning now
runs only for bench builds; non-bench images retain their local-crate artifacts.

The requested one-core, zero-reader hold at the new bound passes at 20,000 users:
49,716 responses, all 200; no dropped actions; all latency windows within target;
336 MB peak app RSS; no OOM kill or observed swap. Sampler continuity confirms it
runs after the Mac wakes, without a sleep gap. The measurement confirms the held
offer, not maximum capacity. [Evidence](lane-measurements/confirm-4096.json),
[raw runner output](lane-measurements/confirm-4096.log), and
[59-test output](lane-measurements/review-native-tests.log) are recorded.
