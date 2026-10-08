# 081.27: Capacity and overload at the deadline-led queue bound

Status: todo

Re-measure the capacity figures for the porting kit after 081.17's 4,096-waiter
backstop and renderer-reuse fix. Kait moved these runs out of 081.17 on 2026-10-08;
they do not block its merge. Use task 10's runner and preserve raw output and input
hashes. The older 32/128 results remain evidence of those settings.

## Acceptance criteria

- [ ] Capacity-only runs on M at 1 core / 0 readers, 1 core / 1 reader,
      8 cores / 0 readers, and 8 cores / 8 readers, using the new bound. Record the
      highest offer that passes the normal held-capacity targets, queue peaks,
      refusal timing, RSS, and generator validity. Keep the 081.17 one-core hold as
      a confirmation point, not a complete matrix or maximum-capacity estimate
- [ ] A valid eight-reader before/after overload comparison at held capacity, 2x,
      4x, and recovery, with adequate generator headroom and zero dropped actions.
      Reserve the Windows machine before using it for LAN k6; a LAN run needs fresh
      capacity references on that path and records network latency separately from
      server timing. No simultaneous port builds on the generator or server
- [ ] RSS recorded at held capacity, 2x, 4x, and recovery; peak RSS within task
      081.10's provisional whole-host budget (2 GiB for M); no OOM kill or swap;
      queues within their bounds; admission refusals as 503 with `Retry-After`;
      and the recovery hold passing the normal capacity targets. The 85% shared-host
      guard is a harness safety stop, not the acceptance budget
- [ ] Whole-host accounting includes OS, replication, and filesystem cache as in
      task 10; report app RSS separately and retain the shared-VM caveat
- [ ] Updated capacity figures and overload results in `native-host.md` and the
      decisions catalogue in 081.05, with raw evidence and excluded runs identified
