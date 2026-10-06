# 081.16: JavaScriptCore as the render engine

Status: in-progress (gate run; the next step awaits a decision)

On the same bundle, Bun runs Solid's synchronous render in 7.3 ms where V8 takes 12.7
([engine-gap report](server-rendering/engine-gap-wsl.md)). JSC's DFG tier is worth 37% to
Bun, while TurboFan is worth 5% to V8. Task 081.14 is expected to leave V8 at about 1.4–1.5
times Bun's CPU. This task checks whether embedding JSC would close that gap, before
anyone builds it.

The engine spike (subtask 01) found the macOS system JSC, through its C API, slower than
V8 on this bundle (16.9 vs 13.7 ms on the timer). So Bun's speed may come from its own
WebKit build, its options, or its native APIs rather than JSC itself. The spike also saw
JSC grow to 300–400 MB of RSS under back-to-back renders.

## Gate: plain JSC on Linux

Before any Rust work, run the render bundle in the `jsc` shell of Bun's prebuilt Linux
WebKit (`oven-sh/WebKit`), with the same answers, phase timers, and limits as the report:

- If JSC's phase B is within about 15% of Bun's and its RSS fits the host's budget, build
  the prototype below.
- Otherwise Bun's lead is specific to Bun. Record that, and compare a Bun render sidecar
  with V8 after task 081.14 instead.

## Gate result

Date: 2026-10-06, on the WSL machine, baseline `db04f03`. The gate fails, narrowly on
speed and clearly on memory. JSC's phase B is 11–22% slower than Bun's, over the 15% line
on week and year. Its peak RSS, 209–255 MB for the renderer alone, doesn't fit the host's
256 MiB for the server with one renderer. Its whole-render CPU is 10–12% above Bun's and
34–40% below the V8 crate's.

### Setup

[`oven-sh/WebKit` `autobuild-2e2aa229`](https://github.com/oven-sh/WebKit/releases/tag/autobuild-2e2aa2290fac856d6f451ceacb58f7f5b44dd057)
is the WebKit of Bun 1.4.2 (`process.versions.webkit`). Its Linux release ships a `jsc`
shell, so nothing had to be built; the runs use the LTO build, as Bun's release does.

`bench/jsc/jsc-bench.js` is `bun-bench.ts` for the shell: the same op stubs and answers,
warm-ups, idle pause, and loop, run against `render.phase.js`. The shell has no web APIs,
so `polyfills.js` adds them in JavaScript: core-js for `URL`, web-streams-polyfill, and
small `Headers`, `Request`, `Response`, `TextEncoder`, `AbortController`, and timer shims.
Phase B calls none of them. `run-jsc.mjs` reads the shell's CPU and peak RSS from `/proc`
while the script waits at markers, since the shell can't read `/proc` itself.

Limits as in the [engine-gap report](server-rendering/engine-gap-wsl.md): one CPU, 2 GiB,
50 warm-ups, a 1.5 s pause, 500 measured renders, and three rounds per page with the engine
order alternating. V8 is the crate's `snowtime-render:phase` image. A, B, and C are wall
ms per render over renders 100–500; CPU is process CPU over the loop.

JSC's HTML is byte-identical to the V8 crate's on all four pages. Bun's differs in the
function sources the stream serializes, because Bun re-prints the bundle when it loads it,
with whitespace changed and syntax minified (`!0` for `true`). So Bun runs a slightly
different program; the `bunsrc` control below runs Bun's re-print in JSC and finds it
doesn't explain the gap.

### Results

Medians of three rounds; ms per render, RSS in MB
([runs](server-rendering/javascriptcore-gate-wsl.jsonl)):

| Page  | Engine           |   CPU |   p50 |   p95 | Peak RSS |    A |     B |    C | B vs Bun |
| ----- | ---------------- | ----: | ----: | ----: | -------: | ---: | ----: | ---: | -------: |
| timer | V8               | 17.42 | 14.61 | 33.54 |      156 | 1.08 | 12.35 | 3.48 |     +74% |
| timer | Bun              | 10.09 |  8.48 | 20.20 |      171 | 0.76 |  7.10 | 2.20 |          |
| timer | JSC              | 11.16 |  8.36 | 30.16 |      237 | 1.16 |  7.90 | 1.83 |     +11% |
| timer | JSC, Bun options | 11.36 |  8.43 | 31.14 |      228 | 1.21 |  8.20 | 1.85 |     +16% |
| week  | V8               | 11.38 | 10.27 | 21.19 |      144 | 1.43 |  6.53 | 2.98 |     +66% |
| week  | Bun              |  6.81 |  5.67 | 12.41 |      154 | 1.03 |  3.95 | 1.76 |          |
| week  | JSC              |  7.56 |  5.19 | 22.40 |      209 | 1.47 |  4.83 | 1.00 |     +22% |
| week  | JSC, Bun options |  7.54 |  5.20 | 23.07 |      210 | 1.47 |  4.74 | 1.11 |     +20% |
| month | V8               | 15.01 | 12.29 | 32.21 |      152 | 1.55 |  9.22 | 3.56 |     +89% |
| month | Bun              |  8.33 |  7.12 | 16.53 |      163 | 1.09 |  4.87 | 2.29 |          |
| month | JSC              |  9.34 |  6.81 | 25.78 |      225 | 1.74 |  5.46 | 2.15 |     +12% |
| month | JSC, Bun options |  9.32 |  6.78 | 24.20 |      218 | 1.74 |  5.43 | 2.00 |     +12% |
| year  | V8               | 18.66 | 14.87 | 37.63 |      157 | 2.55 | 11.19 | 4.26 |    +102% |
| year  | Bun              | 10.13 |  8.58 | 18.66 |      174 | 1.54 |  5.55 | 3.00 |          |
| year  | JSC              | 11.26 |  8.58 | 26.36 |      243 | 2.30 |  6.67 | 2.29 |     +20% |
| year  | JSC, Bun options | 11.38 |  8.79 | 26.77 |      255 | 2.06 |  6.47 | 2.75 |     +17% |

Plain JSC closes 66–86% of V8's phase B gap to Bun. Its C is at or below Bun's even with
JavaScript streams, and its p50 matches Bun's, but its p95 is 1.4–1.8 times Bun's.

### Bun's options aren't the cause

Bun 1.4.2 sets five JSC options to values other than the shell's defaults
(`ZigGlobalObject.cpp`): `heapGrowthSteepnessFactor=1`, `heapGrowthMaxIncrease=2`,
`largeHeapSize=8388608`, `useV8DateParser`, and `useShadowRealm`. With them, B and RSS
move within noise.

### Controls

One run each, Bun's options applied except in the non-LTO row:

| Change         | Timer B | Year B | Timer p95 | Timer RSS |
| -------------- | ------: | -----: | --------: | --------: |
| None           |    8.20 |   6.47 |     31.14 |       228 |
| Non-LTO build  |    8.50 |   6.74 |     32.35 |       237 |
| Bun's re-print |    8.24 |   6.28 |     28.62 |       222 |
| FTL off        |    7.54 |   6.44 |     19.77 |       197 |
| DFG off        |   13.21 |  11.35 |     24.32 |       144 |
| One GC marker  |    8.21 |   6.38 |     32.63 |       227 |

- Without the DFG tier, B rises 61–75%; Bun's CPU rose 59% without it in the engine-gap
  report.
- FTL adds nothing to B after warm-up but keeps compiling: the JIT worker uses 2.1 ms of
  CPU per timer render with it and 0.6 ms without. On one CPU those compiles take the core
  from the render thread. Turning FTL off brings p95 to 19.8 ms on the timer and 22.6 on
  the year, against Bun's 20.2 and 18.7. Why Bun's FTL doesn't cause the same spikes is
  open.
- The non-LTO build is 1–8% slower in B than the gate's plain JSC runs. Bun's re-printed
  source and the number of GC marker threads make no difference.

### Memory

At the end of the loop on the timer, RSS split by `/proc/self/status` and, in a second
run, by mapping ([memory](server-rendering/javascriptcore-gate-wsl-memory.json)):

| MB, timer                | Bun | JSC | JSC, FTL off |
| ------------------------ | --: | --: | -----------: |
| Anonymous                | 140 | 199 |          169 |
| File-backed              |  40 |  30 |           26 |
| Large anonymous mappings | 130 | 185 |          160 |
| JIT code (`JSJITCode`)   | 7.6 | 8.7 |          8.0 |

The gap is in the large anonymous mappings, which hold the GC heap and its allocator; the
binary, JIT code, malloc, and stacks don't explain it. Two causes show in the data:

- GC pacing. With `logGC`, the shell starts an eden collection after about 20 MB of
  allocation, Bun after 8–15 MB, and the shell's heap after a collection is 36–37 MB
  against Bun's 27–28 MB. Summed GC pauses are about equal. Passing Bun's `largeHeapSize`
  to the shell doesn't lower RSS, so the difference likely comes from Bun's
  `GarbageCollectionController`, which starts collections from the event loop.
- FTL. Turning it off shrinks those mappings by 25 MB on the timer.

### Decision and recommendation

By the rule above, Bun's lead is partly specific to Bun: plain JSC gets most of its speed
but not its memory or p95. Closing those takes runtime work Bun has done and an embedding
would redo: GC pacing driven by the host and a policy for the FTL tier.

The recommendation is to follow the rule: measure a Bun render sidecar against V8 after
task 081.14. A sidecar has Bun's CPU and RSS today, so it shows directly whether Bun's
numbers survive a process boundary and IPC per render. Reopen the JSC prototype if the
sidecar's process or IPC cost erases its lead, or if a single binary matters more than the
work. Its first milestone would then be memory: RSS within the host's budget, with GC
paced by the host and the FTL tier limited, before any CPU work.

Proposed for both paths: the host chooses the renderer and its count from the deployment's
memory budget, so small hosts can drop server rendering, where the project allows it, and
large ones can run the fastest engine. Engine options, the bundle variant, and the web API
implementations are settings read when a renderer starts. Only changes to which code the
bundle contains, such as minification, need a build flag.

### Reproduction

The scripts are in `native/crates/render/bundle/bench/jsc/`. Set `RENDER_RESULTS` to the
directory with the captures and `answers.json`, then:

1. `fetch-jsc.sh` downloads both WebKit builds to `JSC_ROOT` (default `/root/jsc`) and
   builds the polyfills.
2. `gate.sh 3` runs the results table on `dist/render.phase.js`, which the engine-gap
   report's `phases.py` derives from `render.orig.js`. `agg.py <raw dir>` prints the
   medians.
3. `gate.sh 1 "timer year" "jsc-plain jsc-bunsrc jsc-noftl jsc-nodfg jsc-1marker"` runs
   the controls. `jsc-bunsrc` needs `dist/render.phase.bun.js`, from
   `bun build --no-bundle --minify-syntax --target=bun`.
4. `mem.sh` runs the memory measurements.

Stop the other containers while measuring. Raw output goes to the ignored
`native/crates/render/results/engine-gap/jsc/`.

## Prototype

A renderer behind the same interface as the V8 one (`Pool`, `PageRequest`, `Page`), so
the host picks the engine at build time. JSC lacks a startup snapshot, so measure renderer
start. Take from Bun only what fits a narrow C++ glue layer (encoding, streams); vendoring
Bun's bindings layer means maintaining a fork of Bun's internals.

## Licensing

Parts of JavaScriptCore are LGPL-2.1. Snowtime and the porting kit being open source lets
users relink a statically linked binary, which LGPL requires. Distributed binaries and
images still need the license notices and the WebKit source with our changes. A porting
kit user who ships closed-source binaries takes on the same obligations, so the kit keeps
V8 (BSD-3-Clause) as an option and documents when to pick each.

## Acceptance criteria

- [x] The gate run recorded: JSC shell, Bun, and V8 on the four pages, with phases A, B,
      and C, CPU, and RSS, and the decision it leads to
- [ ] If the gate passes: a JSC renderer behind the V8 renderer's interface, passing the
      render tests and hydration on all four pages
- [ ] If the gate passes: CPU, p95, renderer start, and RSS at one renderer and at the
      host's renderer count, against V8 after task 081.14 and against Bun
- [ ] If the gate fails: a Bun sidecar measured the same way, against V8 after task 081.14
- [ ] The LGPL obligations for Snowtime's images and for porting kit users checked and
      written into the porting kit, with V8 kept as the engine for closed-source ports
