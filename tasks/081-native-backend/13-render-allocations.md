# 081.13: Render allocations and the remaining engine gap

Status: done (scoped measurements and selection; engine gap remains open)

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

## Recorded investigation

[The WSL report](server-rendering/render-allocations-wsl.md) contains allocation-site
estimates, named GC/compiler self samples on every page and thread, and profiler
coverage/overhead for both engines. Bun's sampler does not expose matching allocation
sites or named GC CPU, and its release perf symbols are mostly unresolved. These are
limits on comparing costs, not evidence that Bun has no GC.

Keep the compatible server-only Solid `mergeProps` own-key adapter. Reject the cached
render-call and bulk descriptor candidates. Timer, week, and month improve in all three
pairs; a mixed year batch has three additional improving pairs. The report preserves
raw measurements and the remaining gap. No application frontend or browser-client
source changes are made. A broader review includes a separate heap-headroom diagnostic;
production memory-policy changes require a host-pressure follow-up.

## Acceptance criteria

- [x] Allocation sites, bytes per page, and GC/compiler CPU recorded for all four pages
- [x] Sampling coverage and profiler overhead recorded for both engines
- [x] At least one candidate tested in three alternating original/candidate rounds
- [x] Only consistent whole-render CPU wins kept, with byte-identical HTML and hydration
- [x] Any frontend change reviewed separately for browser semantics and render savings
- [x] Remaining CPU difference to Bun recorded without assigning unnamed samples to GC
