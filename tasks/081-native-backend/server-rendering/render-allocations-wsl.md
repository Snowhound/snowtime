# Render allocation and engine investigation on WSL

Date: 2026-10-06. Baseline: `f0cd1bf`, branch `081-render-web-apis`.
This investigation covers isolated rendering, not whole-server HTTP load.

## Method and verification

Work, builds, captures, and measurements run in `/root/snowtime` on Ubuntu WSL.
The checkout starts clean. Rebuilding the render bundle produces the same SHA-256
for `render.js` and the production-client manifest. The four request fixtures and
recorded API answers remain unchanged. Their hashes and machine/tool versions are
in `render-allocations-wsl-machine.txt`.

The machine is the Ryzen 7 5800X3D recorded in task 081.12, with the same WSL kernel
and Windows AMD Ryzen Balanced plan. Bun is 1.4.2 and Rust is 1.99.0. Docker runs
use `--cpus=1 --memory=2g`, one renderer and client, one initial render, 50 warm-ups,
1.5 seconds idle, and 500 measured renders. The app and Caddy containers are stopped
during profiling and comparisons. Mailpit remains idle. They are restored afterward.

Each candidate has three alternating comparisons per page: control then candidate
in rounds 1 and 3, candidate then control in round 2. Each pair also has a fresh
uninstrumented native Bun run. Both engines use matching request captures, API answers, and manifests. The cached-call
comparison uses the original bundle in both engines. The prop-helper comparisons use
the candidate bundle for Bun; separate original-bundle Bun references are also recorded.
The final gap table names its reference explicitly. Both callbacks copy the answer bytes. V8 CPU uses process
`getrusage`; Bun uses process `cpuUsage`. These include process background threads.
Uninstrumented process CPU is the performance target.

V8 inspector CPU sampling uses 1 ms intervals. Allocation sampling uses 128 KiB
intervals and includes objects collected by both minor and major GC. Its estimated
bytes describe sampled V8 heap allocations, not Rust allocations, external buffers,
or an exact object count. The inspector's main-thread CPU samples include idle
and omit background threads.

The allocation tree exceeds serde_json's default nesting limit. The harness now
preserves the inspector's profile payload as raw JSON, avoiding a silent parse
failure and a large parsed-tree clone. A regression test covers deep payloads.
The profiler stops before an extra, unmeasured render. Its finish CPU includes
collection, output, and that extra render, so it is an upper bound on collection
and serialization alone. Those costs are excluded from loop CPU. Perf recorder CPU is outside process
`getrusage`/`cpuUsage`; final runs additionally bracket the loop with cgroup v2
`cpu.stat` counters to include the recorder. Initial perf rows lack that counter,
so their process timings alone understate total profiler cost.

Bun's sampler wraps a callback whose CPU counters now end inside that callback.
The reported loop excludes profile-result construction. The outside-loop counter
includes sampler setup and result construction; JSON serialization is separately
timed in the current harness. The initial runs' `profile_collection_cpu_ms` field
names that outside-loop remainder. Bun provides JavaScript stack samples and tier
labels, not an allocation-site sampler or a matching GC CPU breakdown.
See [Bun's profiling reference](https://bun.sh/reference/bun/jsc/profile) and
[benchmarking documentation](https://bun.sh/docs/project/benchmarking).

Whole-process perf uses 99 Hz software `cpu-clock`, DWARF stacks, all inherited
threads, and FIFO enable/disable acknowledgements around the measured loop.
It excludes startup, warm-ups, and idle collection. V8 JIT dumps use monotonic
timestamps and are injected inside the container. Samples in kernel code cannot
be resolved without matching kernel symbols. Bun's release binary and JIT code
remain mostly unresolved in perf. Unresolved samples are never assigned to GC.

A first draft tested the harness before fixing deep-profile handling and overlapped
some builds. It is excluded. The recorded profiling runs use the corrected harness
and run sequentially without builds. Inspector, allocation, Bun sampler, and perf
runs are separate. A single instrumented/uninstrumented run per mode estimates
profiler overhead; it does not establish its variance. Docker's default swap allowance
remains enabled with the requested 2 GiB memory limit. Bun's large sampled result can
reach about 2 GiB peak RSS; result construction may incur memory pressure. Plain
rendering uses far less memory, and no instrumented number is a performance target.

## Allocation and CPU evidence

The source summaries distinguish Lucide's embedded `src/Icon.tsx` and shared
paths from Snowtime's `src/`. Earlier summaries counted those library paths
inside the app bucket.

| Page  | Estimated heap MB/render | Solid MB | App MB | Router/query/serialization MB |
| ----- | -----------------------: | -------: | -----: | ----------------------------: |
| timer |                     7.91 |     3.81 |   1.18 |                          0.47 |
| week  |                     5.29 |     2.67 |   0.61 |                          0.66 |
| month |                     7.51 |     3.00 |   2.03 |                          0.87 |
| year  |                     9.81 |     3.26 |   3.60 |                          1.06 |

Solid's descriptor maps, per-property getter closures, component owners, dynamic
elements, and HTML strings dominate the sampled allocations. The timer's
`mergeProps` alone accounts for about 1.37 MB/render and `splitProps` for 0.49 MB.
The report app allocation grows with the number of rendered timesheet cells.
The summaries record the specific sites and distinguish router, query, and
serialization allocations.

The calendar already caches formatter constructors. Its numeric parts cache
also avoids repeated ICU work on the captured instants. The timer's `wallClock`
samples estimate about 98 kB/render, plus about 73 kB in `offsetAt`. Reports
make only four numeric parts calls at one instant. This path remains work, but
the captures do not support blaming report CPU on formatter construction.

Router and Query setup construct request-local caches, route matches, and
observers; serialization encodes their hydration data. Reusing those objects
across requests would change isolation and hydration semantics. The profiles
do not justify that change. API schema decoding remains a small sampled CPU
bucket. Streams remain unchanged; the rejected direct writer is not retried.

### Whole-process named costs

| Page  | Perf samples | Named GC self | Named compiler self | V8 workers | Bun unresolved |
| ----- | -----------: | ------------: | ------------------: | ---------: | -------------: |
| timer |          925 |        21.08% |               3.14% |     22.70% |         99.81% |
| week  |          594 |        18.86% |               4.55% |     22.90% |         99.72% |
| month |          790 |        24.18% |               3.42% |     24.94% |        100.00% |
| year  |          996 |        27.51% |               2.71% |     25.40% |         99.61% |

No samples are lost. The summary counts the first frame of each perf stack rather
than adding rounded report percentages; each sample belongs to one conservative
bucket. Named GC/compiler shares are lower bounds on identifiable self symbols,
not complete subsystem totals. V8's ICU/Intl named self share is 0.86–1.18% and
string/encoding is 2.05–3.61%. Bun worker names cover about 15–23% JITWorker
samples and 0.58–1.18% mi-scavenger samples. Their unresolved instructions cannot
be labelled compilation or collection from thread names alone.

V8's inspector GC shares are 20.89%, 17.74%, 23.27%, and 27.36%, with idle
included. Solid's shares are 37.67%, 31.48%, 33.78%, and 28.73%. These main-thread
wall-sampling percentages have different denominators from whole-process CPU perf.
Their agreement on substantial prop/render and collection work supports the leads,
but subtracting them from Bun's native bucket would invent an engine decomposition.

## Results and limitations

### Profiler overhead

Final single-run measurements use the selected bundle. Percentages compare each
instrumented process loop with that engine's plain loop in the same profiling batch:

| Page  | V8 inspector | V8 allocation sampling | V8 perf | Bun sampler | V8 finish CPU: inspector/allocation ms | Bun outside loop / JSON output ms |
| ----- | -----------: | ---------------------: | ------: | ----------: | -------------------------------------: | --------------------------------: |
| timer |        +8.1% |                 +12.9% |   +2.5% |      +36.8% |                              194 / 406 |                        4614 / 398 |
| week  |       +11.9% |                 +11.5% |   +4.8% |      +21.4% |                              195 / 403 |                        1415 / 229 |
| month |        +9.3% |                 +11.7% |   +3.1% |      +42.9% |                              209 / 419 |                        2866 / 283 |
| year  |        +8.4% |                  +9.3% |   +3.8% |      +86.4% |                              215 / 445 |                      10345 / 1309 |

V8 finish costs include one extra render, so they bound collection/output rather than
isolating those steps. Bun outside-loop costs include setup and result construction;
JSON output is additional. The sampler's render-loop CPU itself is already inflated.
These final loops are 13.93, 9.42, 12.03, and 18.92 ms for Bun, versus plain 10.18,
7.76, 8.42, and 10.15 ms. The week's plain reference is higher than the three-round
6.90 ms median. This variation limits the precision of its overhead estimate.

Cgroup loop CPU for perf adds only about 0.005–0.012 ms/render beyond renderer process
CPU in this batch. It includes the recorder and container overhead rather than silently
excluding them. Bun perf process CPU is 10.35, 7.02, 8.49, and 10.45 ms. Its changes
relative to the single plain references are mixed, including a negative week estimate.
The original profiling batch also varies; neither establishes a precise perf penalty.
Uninstrumented three-round medians are the comparison targets throughout.

### Candidate selection

Keep own-key enumeration in Solid's server-only `mergeProps`. The original helper
constructs a descriptor map and per-key descriptor objects, then uses only their keys.
The replacement enumerates own keys and calls `hasOwnProperty` for each to preserve
proxy descriptor traps without those objects. It keeps the original lazy getter and
fallback behavior. It preserves non-enumerable keys, primitive boxing, mutation,
undefined fallback, and inherited enumerable keys from `Object.prototype`. Symbols
receive their descriptor trap and remain excluded, as in the original loop.

The isolated build adapter fails closed if the installed Solid implementation changes.
Four compatibility tests cover these cases, including throwing proxy traps. It changes
only the render bundle. There are no edits under `src/`, no browser-client changes, and
no native host/server changes. Existing permissively licensed dependencies suffice.
The transform's source map preserves upstream line attribution, with columns at zero.

The final allocation sampler estimates 7.97, 5.28, 7.47, and 9.74 MB/render, versus
original 7.91, 5.29, 7.51, and 9.81 MB. This is nearly flat. The timer's charged
prop-helper allocation estimate increases from 1.88 to 2.30 MB/render; other buckets
move in the opposite direction. Allocation-site attribution and new key arrays can
move those costs. The observed CPU win does not establish lower total allocation or
lower GC CPU. Large surviving allocation/GC costs remain a follow-up.

| Candidate                 | Timer CPU change |   Week |  Month |   Year | Decision                    |
| ------------------------- | ---------------: | -----: | -----: | -----: | --------------------------- |
| Cached V8 render function |           +1.78% | -0.16% | -0.01% | -0.20% | Reject                      |
| Bulk property descriptors |           +7.26% | +5.56% | +5.14% | +4.74% | Reject                      |
| Initial own-key loop      |           +0.19% | -1.76% | -2.32% | -0.83% | Replace for compatibility   |
| Compatible own-key loop   |           -1.85% | -1.99% | -1.96% | -1.20% | Keep with year confirmation |

These are changes in medians of three alternating pairs, not confidence intervals.
The compatible loop improves every timer, week, and month pair. Pair ranges are
-4.68 to -1.23%, -2.45 to -1.99%, and -4.73 to -0.41%, respectively. The first
year batch has two improvements and one +0.70% regression. Three extra year pairs
all improve, by -2.08%, -4.64%, and -4.27%. Their medians are 19.35 versus 18.53 ms.
Keep the modest gain; do not infer a precise gain from either year's batch alone.

The cached-call experiment replaces per-request script execution with a saved function
and JSON input. Its negligible report changes and timer regression do not justify the
handle lifecycle complexity. Bulk `defineProperties` reduces API-call count but makes
whole renders slower on every page. Reproduction patches and all raw rounds stay with
this report. The earlier string writer remains rejected and is not retried.

### Selected render CPU and remaining gap

| Page  | Original V8 CPU ms | Selected V8 | Change | Bun selected bundle | V8 above Bun |
| ----- | -----------------: | ----------: | -----: | ------------------: | -----------: |
| timer |             17.810 |      17.480 | -1.85% |              10.187 |        71.6% |
| week  |             11.706 |      11.473 | -1.99% |               6.896 |        66.4% |
| month |             15.257 |      14.957 | -1.96% |               8.556 |        74.8% |
| year  |             19.082 |      18.852 | -1.20% |              10.281 |        83.4% |

Bun uses native web APIs and the selected SSR bundle in this table. The adapter improves
Bun too, so a V8 improvement does not translate directly into the same reduction in
the engine gap. Three separate original-bundle Bun references have medians 10.578,
7.004, 8.715, and 10.309 ms. The renderer still spends about 6.4–8.6 ms more CPU per
page than matching Bun. The year confirmation improves V8 further but is a separate
batch, not a substitute for the primary table's year row.

Original and candidate V8 HTML is byte-identical for every comparison, including the
fixed harness nonce. Native Bun's documents have a pre-existing 433-byte difference
from V8's; cross-engine byte identity is not claimed. Both use the same captures and
answers. Separate Bun original/selected renders also pass exact byte equality on every
page; per-engine candidate equality is the compatibility requirement.

### Broader review

The larger architectural opportunities involve fewer component/prop objects and fewer
request-local router/query objects. They require application or upstream framework work
and must preserve request isolation and hydration. A blanket framework fork or shared
query cache is not justified by this small adapter's results. Calendar constructor
caches already exist, and report calendar allocation is only about 14–17 KiB/render.
URL, WebIDL, answer decoding, and streams have small named shares. The existing writer
rejection prevents treating a stream rewrite as an obvious saving.

Whole-process symbols show repeated property lookup/descriptor work and collection,
with compiler work in the low single digits. Caching the render call already tests the
cheap compilation avenue without a useful win. Output-buffer allocation and copying
are not dominant named self sites; adding a second buffer API or pooled body ownership
has a much lower plausible ceiling than reducing the JS allocation graph.

A default single-threaded V8 mode is also not a portable fix for this CPU-limited test.
The renderer serves hosts with several CPUs and uses deno_core's foreground-task
integration. Removing workers or replacing its platform would change that behavior.
A follow-up can test worker policy at one and several CPUs, measuring CPU, tail latency,
and memory before selecting a host-aware setting.

A separate 128/256 MiB heap-policy diagnostic tests the remaining cheap architectural
lead: more headroom before forced collection. It changes the heap limit and proportional
collection/replacement thresholds together, so it cannot isolate one threshold's effect.
It is not retained as production code: the host supplies a memory-derived policy, and
raising one renderer's budget competes with renderer count and server memory. A follow-up
must distinguish forced and automatic GC and test memory/latency under host pressure.

The concrete next investigation is a forced/automatic GC timeline with allocation rate,
heap occupancy, and isolate replacements, compared at the host's actual renderer count.
Keep the total host memory budget fixed when comparing policies. For the engine
comparison, obtain an unstripped Bun/JSC build with JIT symbols before treating its
unresolved perf work as collector or compiler CPU. Upstream SSR prop specialization
is worth testing only with the same lazy-getter/proxy compatibility suite and whole-page
comparisons; larger application changes must earn their cost with stronger savings.

The evidence identifies substantial V8 prop/render allocation and named GC work.
It does not quantify Bun's corresponding allocation or GC cost. Therefore it
does not prove a numerical decomposition of the engine difference. JIT worker
thread names identify sampling coverage, not the operation at every unresolved
address.

Large profiles, matching bundles/maps, perf data, stacks, and JIT dumps stay under
ignored `native/crates/render/results/allocation/`. Raw timing JSON and compact
summaries live beside this report. The ignored temp handoff links to this report;
the report and committed harness are the portable handoff for other machines.

### Heap-headroom diagnostic

All twelve pairs improve CPU with 256 MiB rather than 128 MiB heap headroom. These
runs use the selected adapter in both modes and unchanged HTML. The collection
threshold rises from 48 to 96 MiB and replacement threshold from 80 to 160 MiB.

| Page  | 128 MiB CPU ms | 256 MiB CPU ms | Change | Peak RSS at 128 / 256 MiB |
| ----- | -------------: | -------------: | -----: | ------------------------: |
| timer |         17.382 |         17.035 | -2.00% |         159.7 / 165.6 MiB |
| week  |         11.358 |         10.958 | -3.51% |         146.0 / 155.3 MiB |
| month |         15.075 |         14.719 | -2.36% |         152.2 / 157.3 MiB |
| year  |         18.810 |         18.010 | -4.26% |         163.4 / 168.6 MiB |

The actual peak increase is only about 5–9 MiB in this short repeated-fixture workload.
That does not bound memory with diverse requests, several renderers, or host pressure.
This result makes memory policy a concrete worthwhile follow-up. It does not establish
that forced collection alone causes the savings, and these changes are not added to the
selected production result. The host and default render policy remain unchanged.

## Validation

Release render Cargo tests pass (five tests), as does Clippy with all targets and
`api-bench`. The four adapter compatibility tests pass. The build adapter pins the SHA-256 of
the entire upstream helper, so unrelated helper edits also fail closed. Production Chrome hydration
preserves 610, 434, 901, and 1,376 keyed nodes for timer, week, month, and year.
There are no browser console/page errors and navigation stays in the same document.
The check now fails if any original keyed node is replaced. All four screenshots are
inspected. The existing Playwright hydration harness is used because agent-browser
is unavailable; no browser package is installed for this pass.

Harness lint, formatting, shell syntax checks, and root/isolated benchmark Knip pass.
The normal app test command encounters an existing time-dependent timer test before
09:15 in Europe/Tallinn: its fixture creates today's entry ending at 09:15, while
`lastEndToday` excludes future entries. Those frontend/helper/test files are unchanged
from `f0cd1bf`. Validation uses the full test script with an ignored Vitest config that
adds a before-each Date-only clock at `2026-10-06T10:00:00Z`. Existing test-specific
clocks still override it, and timers run normally. The full run passes 451 Bun and 179 component tests. The production clocks and all
performance measurements are unaffected. This clock dependency remains a frontend
test follow-up; it is not fixed by this render change.

To reproduce the controlled-clock validation, create these ignored files in
`native/crates/render/results/allocation/`:

```ts
// test-clock.ts
import { beforeEach, afterEach, vi } from 'vitest'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-06T10:00:00Z') })
})
afterEach(() => vi.useRealTimers())
```

```ts
// test-config.ts
import { mergeConfig } from 'vitest/config'
import config from '../../../../../vitest.config'
export default mergeConfig(config, {
  test: { setupFiles: ['./native/crates/render/results/allocation/test-clock.ts'] },
})
```

Run `bun run test --config ./native/crates/render/results/allocation/test-config.ts`.

## Raw records and reproduction

- [Production-client hydration checks](render-allocations-wsl-hydration.json)
- [Heap-policy raw pairs](render-allocations-wsl-heap-policy.jsonl) and
  [medians](render-allocations-wsl-heap-policy.json)
- [Machine, tools, image IDs, and fixture hashes](render-allocations-wsl-machine.txt)
- [Final profiling-mode runs, including cgroup CPU and separate serialization](render-allocations-wsl-final-profile-runs.json)
- [Final allocation/CPU/perf summaries](render-allocations-wsl-final-profiles.json)
- [Year confirmation and original-bundle Bun references](render-allocations-wsl-confirm.jsonl)
- [Original profiling-mode runs](render-allocations-wsl-profile-runs.json)
- [Original allocation, inspector, Bun, and perf summaries](render-allocations-wsl-profiles.json)
- [Candidate medians and paired changes](render-allocations-wsl-candidates.json)
- [Cached-call rounds](render-allocations-wsl-call.jsonl) and
  [reproduction patch](render-allocations-wsl-cached-call.patch)
- [Bulk-descriptor rounds](render-allocations-wsl-solid.jsonl) and
  [generated-bundle patch](render-allocations-wsl-solid.patch)
- [Initial own-key rounds](render-allocations-wsl-keys.jsonl)
- [Compatible own-key rounds](render-allocations-wsl-keys-safe.jsonl)

[The render README](../../../native/crates/render/README.md) describes the committed
comparison, allocation, perf, and heap-policy scripts. Rebuild the original bundle at
`f0cd1bf`, verify its recorded hash, and save its image and bundle/map before building
the selected adapter. Recorded data can be compared across machines, but new captures
must come from the same production client/manifest and seeded API state. Never copy
these ignored captures or cookies into the tracked report.
