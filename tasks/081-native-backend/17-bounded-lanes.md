# 081.17: The lane contract, the overload policy, and refusal in the client

Status: in-progress

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
- [ ] Each gate refuses at once, with 503 and `Retry-After`, when its waiting callers reach
      a maximum, with a test; the maximum and the deadline recorded in native-host.md with
      the measurement that set them
- [ ] Reports and exports admitted through a smaller budget inside the database lane. With
      one organization bursting reports, other organizations' timer p95 and refusals
      measured before and after
- [ ] Password hashing on dedicated threads below the other lanes' OS priority, sized from
      memory (32 MiB a hash) as well as cores; `spawn_blocking` reached only through a
      gate, checked by a test or a lint
- [ ] A fixed load with a burst of sign-ins (10 a second for 10 seconds) before and after:
      the p95 of the other request kinds during the burst
- [ ] The ramp past capacity before and after: app RSS stays within 10% of its value at
      capacity, and the excess load shows as 503s

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
- [ ] Tokio's `current_thread` runtime compared with the multi-threaded one on one core,
      with CPU per request and p95, and the choice recorded in native-host.md
- [ ] The client keeps `Retry-After` on a refused call. A write refused with 503 keeps its
      optimistic change, pending with a retry action, and nothing retries it on its own.
      Reads retry with jitter, waiting at least `Retry-After`. A test injects 503s into an
      edit and the queries it invalidates, and counts the attempts
- [ ] The decisions catalogue in task 081.05 updated with the results

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
