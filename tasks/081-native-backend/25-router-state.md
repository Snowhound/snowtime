# 081.25: The router's state in the page

Status: todo

After task 081.23, the two largest render costs left are V8's garbage collection (9.6% of
month's and 11.0% of year's self samples) and serializing the router's state into the
page for hydration (`dehydrate` and `crossSerializeStream`, about 5.4% of year's samples
including callees). Both grow with what a render allocates and sends. Find what each
page's hydration state holds, and send less where the client doesn't use it.

Tasks 081.21–23 timed their candidates in alternating rounds, and single runs swing 20–30%.
Changes that removed work showed +1–3% on some pages, so effects of that size are below
the timing noise. Judge this task's candidates first by a measure that doesn't vary
between runs: the hydration state's bytes per page, and allocated bytes or instruction
counts per render where the host can report them (V8 heap statistics, or `perf stat` on
Linux where Docker exposes the counters). Timing rounds then confirm the result.

## Acceptance criteria

- [ ] The hydration state of timer, week, month, and year broken down by query and router
      field, in bytes, with what the client reads of each after hydration
- [ ] A deterministic per-render measure chosen and recorded, with its run-to-run spread
- [ ] Each candidate kept only if it lowers that measure and the timing rounds show no
      cost on V8 or Bun; hydration check passing on all four pages
- [ ] Any app change reviewed for what the browser loses: a query it would refetch
      after hydration counts against the saving
- [ ] Results added to task 081.21's report, with the remaining GC share
