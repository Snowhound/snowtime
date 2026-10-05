# 081.13: Render allocations and the remaining engine gap

Status: todo

Task 081.12's WSL isolate profiles put Solid, app rendering, and GC ahead of the
web API JS layers. Solid accounts for 26–33% of V8 main-thread self samples and
named GC for 18–26%, with idle included. Bun's unnamed native samples and V8's
background threads prevent treating those percentages as a decomposition of
their whole-process CPU difference.

Find the allocation sites and compiler work responsible for the remaining render
cost before changing collection thresholds or frontend rendering. The direct
string writer increased CPU and must not be reintroduced from its stream sample
share alone.

## Method

Use the same timer, week, month, and year captures, one CPU, 2 GiB, 50 warm-ups,
and three runs of 500 renders. Profile the measured window separately from
uninstrumented timing. Capture V8 allocation samples plus perf stacks for all
threads, including GC and compiler work; compare with bounded Bun samples.

Start with Solid mergeProps/splitProps, router and query setup, serialization, and
the calendar's wallClock/Intl path. Attribute native symbols and allocation
counts before choosing a fix. Existing calendar/date-input formatter caches
already avoid repeated formatter construction.

## Acceptance criteria

- [ ] Allocation sites, bytes per page, and GC/compiler CPU recorded for all four pages
- [ ] Sampling coverage and profiler overhead recorded for both engines
- [ ] At least one candidate tested in three alternating original/candidate rounds
- [ ] Only consistent whole-render CPU wins kept, with byte-identical HTML and hydration
- [ ] Any frontend change reviewed separately for browser semantics and render savings
- [ ] Remaining CPU difference to Bun recorded without assigning unnamed samples to GC
