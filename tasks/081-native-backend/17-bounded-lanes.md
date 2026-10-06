# 081.17: The lane contract for the database and password hashing

Status: todo (after subtask 10 merges into `081-native-poc`)

Close the gaps between subtask 10's admission gates (`native/crates/server/src/admission.rs`
on `081-load-and-scaling`) and the lane contract in
[native-host.md](../../docs/architecture/native-host.md). The gates already cap blocking
threads and refuse after `WORK_QUEUE_TIMEOUT_MS`. Waiting isn't bounded by count (872
callers waited at the 40,000-user peak), the hash lane is sized from cores alone, and
sign-in bursts still share the core with every request.

Measure with `perf:stress` as subtask 10 does, on M and one core first, with the ramp
continued past capacity.

## Acceptance criteria

- [ ] Each gate refuses at once, with 503 and `Retry-After`, when its waiting callers reach
      a maximum, with a test; the maximum recorded in native-host.md with the measurement
      that set it
- [ ] The ramp past capacity before and after the count bound: app RSS stays within 10% of
      its value at capacity, and the excess load shows as 503s
- [ ] `SCRYPT_CONCURRENCY` sized from memory as well as cores (32 MiB per hash), and its
      threads run below the other lanes' OS priority on Linux
- [ ] A fixed load with a burst of sign-ins (10 a second for 10 seconds) before and after:
      the p95 of the other request kinds during the burst
- [ ] Tokio's `current_thread` runtime compared with the multi-threaded one on one core,
      with CPU per request and p95, and the choice recorded in native-host.md
- [ ] An owner thread for the writer compared with the gate, only if the profiles of task
      081.12 show time in the writer's mutex or in thread handoff; otherwise recorded as
      not needed
- [ ] `spawn_blocking` reached only through a gate, checked by a test or a lint
- [ ] The decisions catalogue in task 081.05 updated with the results
