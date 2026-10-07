# Newer V8 builds on WSL

Measured on 2026-10-07 for [081.18](../18-v8-builds.md), in the fresh
`/root/snowtime-v8-builds` worktree on `081-v8-builds`, based on `081-render-gc` at
`f7f5144`. `/root/snowtime-gc` and its ignored results were preserved. The pool code,
production dependencies, and renderer source are unchanged.

## Recommendation

Stop this engine-upgrade investigation and rely on the Bun sidecar for the render gap.
There is no demonstrated shipping V8 win. The newest engine accepted by the published
`deno_core` dependency graph leaves the two retention mechanisms unchanged and does not
improve getter creation materially. Newer milestone shells still trail JavaScriptCore
by about 9–11 times on getter literals and about 4 times on the combined props test.
No named forthcoming Rust release is known to change either retention policy.

The investigation has one unmet acceptance criterion: the synthetic workload does not
reproduce the real bundle's variant ranking, so its timings do not select candidates.
This report does not claim that synthetic results predict real pages.

## Method and engine provenance

Docker `ubuntu:24.04`, one CPU quota, 2 GiB memory, three serial alternating rounds.
Round two reverses engine order and, for the variant comparison, variant order.
V8 uses 32 MiB minimum/maximum semi-space and a 128 MiB old-space limit. Real and
synthetic timing runs have 50 warmups and 500 measured renders. GC trace runs measure
200 renders separately. Probe runs force a full collection, drop one workload, then
force two minor collections. Tables use arithmetic means of the three rounds.

Synthetic CPU sums `/proc` user and system ticks across all engine threads and wrapper
children; this host reports 100 Hz ticks. Real Node/Bun CPU uses `process.cpuUsage()`.
Promotion is the sum of trace `promoted` fields between probe markers. Both legacy
name/value and newer JSON traces are parsed. Embedded traces were repeated with C
stdout line buffering after the first logs interleaved Rust markers with buffered V8
output. Those earlier embedded traces are excluded from the committed
[round data](v8-builds-wsl.json).

| Label                     | Installed version                                                 | Shipping interpretation                                    |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| Embedded baseline         | deno_core 0.405.0, rusty_v8 149.4.0, V8 14.9.207.2                | Existing native build                                      |
| Embedded accepted upgrade | deno_core 0.412.0, deno_v8 0.4.0, rusty_v8 150.4.0, V8 15.0.245.2 | Newest accepted published dependency set                   |
| d8 baseline               | 14.9.207                                                          | Milestone shell, differs from baseline patch .2            |
| d8 Rust milestone         | 15.2.124                                                          | Rust 152 uses patch .1; not accepted by the current facade |
| d8 stable milestone       | 15.5.35                                                           | jsvu milestone shell                                       |
| d8 beta milestone         | 15.6.75                                                           | jsvu milestone shell                                       |
| d8 canary                 | 15.7.63                                                           | jsvu canary shell                                          |
| Node 24                   | 24.21.0, V8 13.6.233.17                                           | Older V8 than native baseline                              |
| Latest Node               | 26.10.0, V8 14.6.202.34                                           | Older V8 than native baseline                              |
| Node v8-canary            | 27.0.0-v8-canary202610062cf7e297b7, V8 15.7.48.0                  | Nightly, no corresponding published Rust release           |
| JavaScriptCore            | WebKit 322809                                                     | jsvu reference shell                                       |
| Bun                       | 1.4.2                                                             | Sidecar reference                                          |

jsvu 3.0.5 resolves `v8@15.5` and `v8@15.6` through the milestone LKGR version header,
but downloads every d8 artifact from the **canary** bucket. These are not exact patched
Chrome stable/beta branch binaries. Current Chrome-for-Testing metadata identified
stable 155.0.8059.39 and beta 156.0.8078.4. This distinction matters when reproducing a
branch-specific fix. See [jsvu's V8 installer](https://github.com/GoogleChromeLabs/jsvu/tree/v3.0.5/engines/v8)
and [Chrome-for-Testing metadata](https://googlechromelabs.github.io/chrome-for-testing/).

The accepted upgrade was also built as the real render crate with matching published
extensions: deno_web 0.290, deno_webidl 0.259, deno_fetch 0.283, and deno_net 0.251.
Build, render tests, and Clippy passed. Its manifests and lockfile were restored after
copying the experiment binary. Published [deno_core 0.412.0](https://crates.io/crates/deno_core/0.412.0)
uses [deno_v8 0.4.0](https://crates.io/crates/deno_v8/0.4.0), whose default backend accepts
Rust 150.4, rather than the newest published Rust 152.2.

## Cheap screens

Seconds per workload; each invocation prints one numeric value. `acc` times 200,000
getter holders with 64-element array payloads dropped in batches of 2,000. `wm` repeats
the aged-WeakMap closure case 100 times. `lit` and `props` run one million iterations.
Short `acc`/`wm` timings vary considerably; they are screens, not a render-speed claim.

| Engine              |    acc |     wm |    lit |  props |
| ------------------- | -----: | -----: | -----: | -----: |
| d8 14.9             | 0.1551 | 0.1259 | 0.5096 | 8.3447 |
| d8 15.2             | 0.1440 | 0.0678 | 0.4952 | 8.6559 |
| d8 stable milestone | 0.1578 | 0.0997 |  0.243 |  0.080 |
| d8 beta milestone   | 0.1697 | 0.1098 | 0.4904 | 8.6310 |
| d8 canary           | 0.1438 | 0.1082 | 0.5043 | 8.7359 |
| Node 24             | 0.1066 | 0.1046 | 0.4977 | 8.8769 |
| Node 26             | 0.1159 | 0.1002 | 0.4821 | 8.7611 |
| Node canary         | 0.1429 | 0.0732 | 0.5235 | 8.7568 |
| JavaScriptCore      | 0.0212 | 0.0160 | 0.0546 | 2.2201 |
| Bun                 | 0.0227 | 0.0152 | 0.0456 | 1.7410 |
| Embedded Rust 149.4 | 0.1370 | 0.0980 | 0.4287 | 8.7987 |
| Embedded Rust 150.4 | 0.1503 | 0.1047 | 0.4257 | 9.0390 |

The embedded pair ran in a separate alternating A/B suite with the same harness and
build settings. Getter literal creation changes by less than 1%; the combined props
workload is 2.7% slower on the upgrade. This does not justify a real-page promotion.
Node 26's modest literal improvement and Node canary's WeakMap timing improvement
qualified them for the real harness, subject to exact HTML. The d8 15.2 WeakMap timing
win has no retention win, while its props workload regresses; the shipping embedded
upgrade does not reproduce that speedup.

The getter probe promotes exactly 1,312,784 bytes on **both** embedded releases;
the WeakMap closure probe promotes exactly 1,136,688 bytes on both. Plain objects,
callable properties, and shared Proxy paths promote only hundreds of bytes. Every d8
milestone retains about 641 KiB through getter literals and 555 KiB through WeakMap
closures. The approximately halved shell sizes reflect pointer compression, not a new
retention policy. Node's process startup noise increases its absolute probe numbers;
subtracting the plain/empty controls leaves the same retained payload scale. Full case
and per-round values are in the JSON. JavaScriptCore/Bun do not expose V8's promoted-byte
or scavenger counters; those metrics are unavailable for them.

## Synthetic render: failed calibration

The workload uses Solid's real server renderer, 256 compiled-prop creation sites,
mergeProps/splitProps, nested components, SSR property literals, a dropped WeakMap key,
and fresh row payloads. It drains Solid's deferred root disposers before probes and
clears the server context as the selected bundle does. Every measured render checks
its HTML against the first render. All five variants emit the same HTML hash and size.

| Variant                | Synthetic CPU ms/page | Synthetic promoted MiB | Real promoted MB in 081.14 |
| ---------------------- | --------------------: | ---------------------: | -------------------------: |
| Control                |                 15.95 |                   7.24 |                       1.50 |
| Proxy merge/split      |                 16.77 |                   7.46 |                       1.25 |
| Lazy compiled props    |                 17.68 |                   6.43 |                       1.43 |
| Both                   |                 12.99 |                   2.26 |                       1.27 |
| Both plus SSR literals |                 11.83 |                   0.67 |                       1.22 |

Proxy CPU rises 5.1%, consistent with the real bundle's 4–7% cost. But its synthetic
promotion rises instead of falling, and lazy props cost 10.9% CPU instead of remaining
neutral on timer. The model attaches large fresh arrays to each getter and therefore
changes the retained object graph far more than the real bundle's small API data.
It also does not establish the requested 8 MB/page allocation match. The calibration
fails; its large apparent combined-variant savings are not evidence for production.

The following diagnostic metrics therefore describe this synthetic workload only.
Promotion is MiB after two forced minor collections; collection counts are per page
in the separate 200-render trace run. JavaScriptCore counters are unavailable.

| Engine              | CPU ms/page | Promoted MiB | Scavenges/page | Mark-compacts/page |
| ------------------- | ----------: | -----------: | -------------: | -----------------: |
| Embedded 149.4      |       15.52 |         7.24 |          0.390 |              0.150 |
| Embedded 150.4      |       15.92 |         7.24 |          0.390 |              0.150 |
| d8 14.9             |       15.25 |         3.72 |          0.230 |              0.073 |
| d8 15.2             |       14.97 |         3.72 |          0.225 |              0.073 |
| d8 stable milestone |       16.07 |         3.71 |          0.243 |              0.080 |
| d8 beta milestone   |       16.29 |         3.71 |          0.230 |              0.073 |
| d8 canary           |       16.21 |         3.71 |          0.230 |              0.075 |
| Node 24             |       15.91 |         7.29 |          0.325 |              0.160 |
| Node 26             |       16.35 |         7.29 |          0.320 |              0.160 |
| Node canary         |       18.55 |         7.32 |          0.320 |              0.160 |
| JavaScriptCore      |        5.49 |            — |              — |                  — |
| Bun                 |        5.01 |            — |              — |                  — |

## Newest flags and build options

On d8 15.7.63, untraced control costs 16.21 ms/page. `--minor-ms` costs 17.79 ms
(+9.7%); disabling concurrent MinorMS marking costs 17.57 ms (+8.4%).
`--no-minor-gc-task` costs 16.18 ms (−0.2%, effectively neutral). MinorMS promotes the
same 3,887,240 bytes as the default collector. Its trace records 0.22 minor mark-sweeps
and 0.11 mark-compacts/page, versus about 0.23 scavenges and 0.075 mark-compacts/page
by default. This failed model cannot validate a production flag win, and none appears
in these diagnostics. Comparing baseline and newest d8 help revealed no newly exposed
young-generation switches to add to this screen.

[`v8_enable_sticky_mark_bits`](https://github.com/v8/v8/blob/main/BUILD.gn) remains off
by default at build time. Its
[flag implications](https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h)
force MinorMS and disable compaction, with
[bug 333906585](https://issues.chromium.org/issues/333906585) referenced for compaction
support. It does not change the explicit old-space allocation of AccessorPair or the
scavenger's ephemeron value visit. From those constraints and the measured MinorMS
regression, a custom sticky-bits build is not a promising candidate worth maintaining.
This is a source-based assessment, not a measured custom-build result.

Pointer compression has a published Linux x64 archive starting at
[Rust 134.1.0](https://github.com/denoland/rusty_v8/releases/tag/v134.1.0), so it is
already available at the engine level before the baseline. However, deno_core 0.405
unconditionally enables V8's simdutf feature. Adding its pointer-compression feature
requests `librusty_v8_ptrcomp_simdutf_release_x86_64-unknown-linux-gnu.a.gz`, which returns 404. The 149.4, 150.4, and 152.2 release asset lists contain ptrcomp and simdutf archives
separately, but not their combination. The isolated build records that failure.
A custom build or dependency fork would be needed to test the supported combination;
compressed d8 already shows that smaller objects do not fix the roots or getter cost.
There is no demonstrated CPU benefit to justify maintaining that fork here.

## Real bundle and exact-output gate

The source-preserving Node harness and capture wrapper evaluate the saved IIFE through
`node:vm`. Otherwise Bun reformats function bodies that the router serializes into its
stream, creating a false HTML mismatch. No serialized content is normalized.

A one-render gate verifies all four pages before lengthy measurements. Node 24 and
26 match timer, but fail week/month/year: their ICU emits thin spaces around the date
range dash, where Bun emits ordinary spaces. Their report-page timings are rejected.
Node canary and Bun match all four pages byte-for-byte (timer 256,125; week 141,014;
month 256,038; year 378,895 bytes). Timer-only results for the older Nodes are retained
as diagnostics, not a four-page candidate win.

| Page  | Canary CPU ms | Canary p95 ms | Canary peak RSS MiB | Bun CPU ms | Bun p95 ms | Bun peak RSS MiB |
| ----- | ------------: | ------------: | ------------------: | ---------: | ---------: | ---------------: |
| timer |         20.53 |         55.52 |              282.38 |      11.11 |      22.96 |           174.97 |
| week  |         13.59 |         47.25 |              270.67 |       7.39 |      15.05 |           156.68 |
| month |         16.91 |         52.04 |              277.31 |       9.16 |      19.02 |           164.60 |
| year  |         20.98 |         56.72 |              277.46 |      11.02 |      21.33 |           173.89 |

The reference is the unchanged [081.14 table](render-gc-wsl.md): native CPU
15.98/10.76/13.84/16.92 ms and p95 29.18/17.13/25.13/31.21 ms, peak RSS
189/183/183/201 MiB for timer/week/month/year. These historical values are not a paired
Node-engine A/B test: Node includes host Web APIs and a different runtime embedding.
The contemporaneous Bun rows show the host's current reference. No shipping native
engine winner advances to a four-page claim, and no future Rust release is inferred
from a Node nightly's version number.

## Source changes since Rust 149.4

Searched V8 path histories and commit search from the baseline's June 2026 release
through 2026-10-07: heap factories, scavenger, MinorMS/visitors, flags/build settings,
objects/lookup, property literals, and dictionary-load compiler paths. Release mapping
compares commit ancestry against denoland/v8's pinned submodule SHAs. Rust 149.4 pins
`73d19698`; 150.0–150.4 pin `ac1e2398`; 152.0–152.2 pin `c4ca1ecc`.
Bug links were followed, but tracker details require sign-in or were unavailable;
findings below use the public linked commits, not inaccessible issue comments.

| Area and change                                                                                                                                                                                        | Effect on this investigation                                                                               | First published rusty_v8 carrier                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [Concurrent-marker synchronization, July 21](https://chromium.googlesource.com/v8/v8/+/b372a84adeddb6e38949092eea51bb8601120d66), [bug 523415148](https://issues.chromium.org/issues/523415148)        | Caches allocation-buffer boundaries per object; relevant to MinorMS concurrent marking, not accessor roots | 152.0.0; absent from 150.x                             |
| [MinorMS memento/LAB handling, August 13](https://chromium.googlesource.com/v8/v8/+/1122c7113cb2d141a7d0065d3c1def0814121b11), [bug 518163386](https://issues.chromium.org/issues/518163386)           | Concurrent correctness fix after an earlier change was reverted; not a retention-policy fix                | None through 152.2.0; first future carrier unpublished |
| [Scavenger JSWeakRef hash forwarding, September 30](https://chromium.googlesource.com/v8/v8/+/55dcff77d1bd944c6d026f7b02e33d49e9f069c6), [bug 567538973](https://issues.chromium.org/issues/567538973) | Fixes unregister-token hash lookup during weak clearing; does not weaken old WeakMap values                | None through 152.2.0; first future carrier unpublished |
| [NormalizedMapCache hashing, September 15](https://chromium.googlesource.com/v8/v8/+/d6fd1b3dd2485c688acfeaa6f4f98239e406924e), [bug 560730175](https://issues.chromium.org/issues/560730175)          | Avoids map-cache collisions across instance types; does not make getter literals use fast properties       | None through 152.2.0; first future carrier unpublished |
| [Dictionary super-load receiver, July 21](https://chromium.googlesource.com/v8/v8/+/ead4e132f56500d081b3a834cb4319fec24284e5)                                                                          | Correct receiver when a data property becomes an accessor; not getter allocation speed                     | 152.0.0                                                |
| [Dictionary load checks JSObject, August 7](https://chromium.googlesource.com/v8/v8/+/c69bace374926ba465a755787cdefaf2c6785e29), [bug 541251902](https://issues.chromium.org/issues/541251902)         | Avoids treating a Proxy hash as a property dictionary; correctness fix                                     | None through 152.2.0; first future carrier unpublished |
| [AccessorInfo no-allocation lookup, September 16](https://chromium.googlesource.com/v8/v8/+/8694b7fe48ad7fb87447a38e2afd74b1ccff1afc), [bug 559408989](https://issues.chromium.org/issues/559408989)   | Native C++ accessor lookup constraint; a different object type from JavaScript AccessorPair                | None through 152.2.0; first future carrier unpublished |

No relevant change to JavaScript AccessorPair allocation was found. The
[current factory](https://github.com/v8/v8/blob/main/src/heap/factory-base.cc) still
allocates it explicitly in old space. The
[current scavenger](https://github.com/v8/v8/blob/main/src/heap/scavenger.cc) still visits
an ephemeron table's value as a pointer during minor collection. Released 149.4, 150.4,
and 152.2 sources were checked as well. Those source findings agree with the probes.
The newer dictionary commits address lookup correctness or normalization-cache
collisions; none demonstrates a getter-literal creation fix for this render workload.

## Reproduction and validation

The benchmark harness was not merged; it stays in the WSL worktree
`/root/snowtime-v8-builds` under `native/crates/render/bundle/bench/v8/`, with its
commands, engine paths, and capture requirements. Raw traces, generated engine
projects, build logs, captures, and rejected partial runs remain under that worktree's
ignored `native/crates/render/results/v8-builds/`; the JSON contains accepted normalized
rounds and exact-output gates, without captured cookies or API answer bodies.

Saved render IIFE SHA-256: `abc570c8837c15de223932d0f910b22270e98c11c2e90e0f6d2e5c66ec98b350`.
Saved manifest SHA-256: `2a4814cb90ad7349dbd4c5a8b5907992d82cab9f140654771ded115ff00e568e`.

Validation passed: baseline and accepted-upgrade render Cargo tests and Clippy;
isolated harness Clippy; benchmark lint and formatting; both Knip scopes; and all
four Start/V8 HTML hydration and same-document navigation checks, with zero replaced
hydration nodes and zero browser errors. The application Bun tests passed (451 tests).
Vitest passed 183 of 184 tests. Its failure is the timer test “Add entry picks recent
work from the keyboard and starts after today’s last entry”: the Start input is empty
instead of `09:15`. It also fails when run alone on this branch and on the untouched
`f7f5144` base in `/root/snowtime-v8-baseline-check` (34/35 timer tests pass). That
pre-existing failure is recorded rather than changed by this benchmark task.
