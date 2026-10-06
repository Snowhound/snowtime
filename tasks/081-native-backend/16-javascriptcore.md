# 081.16: JavaScriptCore as the render engine

Status: in-progress (gate failed; the Bun render sidecar is next)

On the same bundle, Bun runs Solid's synchronous render in 7.3 ms where V8 takes 12.7
([engine-gap report](server-rendering/engine-gap-wsl.md)). JSC's DFG tier is worth 37% to
Bun, while TurboFan is worth 5% to V8. Task 081.14 left V8 at 1.50–1.63 times Bun's CPU
([report](server-rendering/render-gc-wsl.md)). This task checks whether embedding JSC would close that gap, before
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

Following the rule, the next step is a Bun render sidecar, measured against V8 after task
081.14 ([plan](#bun-render-sidecar)). A sidecar has Bun's CPU and RSS today, so it shows
directly whether Bun's numbers survive a process boundary and IPC per render. Reopen the
JSC prototype if the sidecar's process or IPC cost erases its lead, or if a single binary
matters more than the work. Its first milestone would then be memory: RSS within the host's
budget, with GC paced by the host and the FTL tier limited, before any CPU work.

Proposed for every engine: the host chooses the renderer and its count from the
deployment's memory budget, so small hosts can drop server rendering, where the project
allows it, and large ones can run the fastest engine. Engine options, the bundle variant,
and the web API implementations are settings read when a renderer starts. Only changes to
which code the bundle contains, such as minification, need a build flag.

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

## Bun render sidecar

Decided by Kait on 2026-10-06: the Bun sidecar is the preferred renderer wherever memory
isn't the deciding constraint. V8 in the host stays the renderer for the smallest memory
budgets and the fallback. The measurements below can still reverse this if the sidecar
loses Bun's lead.

The reasons are Bun's render CPU (34–40% below V8 at the time; after task 081.14, V8
takes 1.50–1.63 times Bun's CPU) and that Bun maintains the engine, GC, and web APIs. A tag bump
brings its improvements, with no fork or bindings of ours to keep up.

### Shape

- **Processes.** The host starts each renderer as a child process: the stock `bun` binary
  running `render-server.js` with the render bundle and manifest. A pool is N processes,
  one renderer each. One process with N Workers, each its own JSC VM, is the alternative to
  measure: it shares Bun's runtime, but one crash takes down the pool.
- **Protocol.** Length-prefixed frames over one Unix socket per renderer. The host sends a
  `PageRequest`; the renderer sends API requests, which the host answers from its
  in-process API, then the status and headers, the HTML chunks, and an end or error frame.
  These carry what `op_send`, `op_head`, and `op_chunk` carry today, so the bundle doesn't
  change: `render-server.js` installs the same `Deno.core.ops` stubs as `bun-bench.ts`.
- **Host.** A `BunRenderer` behind the V8 renderer's interface (`Pool`, `PageRequest`,
  `Page`). `RENDER_ENGINE` (`bun` or `v8`) picks the engine at start.
- **Supervision.** Renderers start with the host and warm up before taking pages. The host
  restarts a renderer that exits, times out a stuck render, and recycles a renderer whose
  RSS (`/proc/<pid>/status`) passes its limit, starting the replacement first where memory
  allows. Readiness and liveness follow "Health" in
  [native-host.md](../../docs/architecture/native-host.md#health).
- **Lanes.** Kait, 2026-10-06: the sidecar follows the host's lane contract
  ([native-host.md](../../docs/architecture/native-host.md)). The rules it adds,
  least privilege, one page in flight per renderer, the page buffered whole, deadlines
  enforced by SIGKILL, a restart budget, recycling one renderer at a time within the
  memory budget, and `socketpair()` with `PR_SET_PDEATHSIG` and a process group, are
  recorded in [native-rendering.md](../../docs/architecture/native-rendering.md#bun-sidecar-planned).
- **Settings.** `RENDERERS` (a count, or sized from the memory budget and CPUs), Bun's
  `--smol`, and `BUN_JSC_*` options, passed through to each renderer at start.
- **Image.** `native/Dockerfile`'s `app` stage copies `bun` from a pinned `oven/bun` image
  (multi-arch, so x64 and arm64 hosts build alike) and the bundle files, about 100 MB more.
  A build arg leaves Bun out of V8-only images. Compose doesn't change: the `app`
  container's memory limit covers the host and its renderers, as the host's sizing
  expects.
- **Upgrades.** One Bun version builds the bundle and runs it: the `oven/bun` tag follows
  `packageManager` in `package.json`, and CI fails when they differ. A dependency bot
  proposes bumps. CI checks each bump, and each change to the render adapter or its
  dependencies: render tests, hydration, HTTP status and headers, and a short CPU and RSS
  run against a stored baseline. The HTML byte comparison with the previous version is a
  diagnostic whose differences are explained, not a gate. A regression holds the pin. The
  image records the Bun version, its digest, the bundle's hash, and the client manifest's
  identity together.

### Memory on the smallest host

On 1 vCPU and 2 GB the host runs one renderer. Peak RSS of a one-renderer process over 500
back-to-back renders is 154–174 MB for Bun and 144–157 MB for the V8 crate (gate results
above), so Bun costs 10–17 MB more per renderer. The sidecar's second process adds little
beyond that: Bun's figure already counts its runtime, and the host drops V8. The estimate
for the whole server at peak under load is 230–240 MB, against the 219 MB measured for
V8 ([task 081.01](01-server-rendering.md)), still under the proposed 256 MiB app target.
It's an estimate from one-renderer runs, not a measurement; 30% more would miss that
target. A recycle that warms the replacement first adds a second renderer's peak for its
warm-up. Task 081.10's provisional whole-host budget for M is 2 GiB.

Two cases differ:

- **Idle.** V8's host idles at 47 MB, because its snapshot's pages load as pages render,
  and at 67–74 MiB after a trim. Bun has no snapshot and its idle RSS hasn't been measured;
  expect it higher.
- **Tight limits.** Under 160–240 MB container limits, V8 held its targets with a 64 MiB
  heap (134 MB peak). A Bun renderer alone peaks above 154 MB, so those budgets stay on V8,
  or without server rendering.

Task 081.14 may move V8's numbers either way: a larger nursery costs memory.

## Prototype

Paused on 2026-10-06 in favor of the [sidecar](#bun-render-sidecar); see the gate's
recommendation for when to reopen it.

A renderer behind the same interface as the V8 one (`Pool`, `PageRequest`, `Page`), so
the host picks the engine at build time. JSC lacks a startup snapshot, so measure renderer
start. Take from Bun only what fits a narrow C++ glue layer (encoding, streams); vendoring
Bun's bindings layer means maintaining a fork of Bun's internals.

## Licensing

Parts of JavaScriptCore are LGPL-2.1.

- **Sidecar.** Bun is MIT and statically links JavaScriptCore from Oven's patched WebKit
  fork (`oven-sh/WebKit`). The image ships that executable as Oven builds it, next to our
  files, and the host talks to it over a socket, so our code isn't linked with the
  library. Redistributing Bun carries its own obligations: the license notices, the exact
  WebKit source of that build, and a way to rebuild and relink Bun with a modified
  JavaScriptCore. The socket boundary keeps those obligations off our code, including
  closed-source ports, but doesn't remove them from the Bun executable we ship. Not a
  legal conclusion until the check in the acceptance criteria is done. Bundling our code into Bun with `bun build --compile` would
  change that, so the image doesn't.
- **Embedded JSC.** Snowtime and the porting kit being open source lets users relink a
  statically linked binary, which LGPL requires. Distributed binaries and images still need
  the license notices and the WebKit source with our changes. A porting kit user who ships
  closed-source binaries takes on the same obligations, so the kit keeps V8 (BSD-3-Clause)
  as an option and documents when to pick each.

## Acceptance criteria

- [x] The gate run recorded: JSC shell, Bun, and V8 on the four pages, with phases A, B,
      and C, CPU, and RSS, and the decision it leads to
- [ ] Sidecar: a `BunRenderer` behind the V8 renderer's interface, passing the render tests
      and hydration on all four pages, with HTML byte-identical to `bun-bench.ts`'s
- [ ] Sidecar: CPU, p50, and p95 per page against `bun-bench.ts` in one process, under the
      gate's limits, so the IPC cost is a number
- [ ] Sidecar: one process per renderer against one process with Workers, CPU, p95, and RSS
      at one renderer and at the host's renderer count
- [ ] Sidecar: `op_send` round trips per page counted for all four pages, with the time a
      renderer spends waiting on them, so the IPC cost per page is known beside the bytes
- [ ] Sidecar: one page in flight per renderer, the page buffered whole up to a maximum
      size, and a render past its deadline killed and replaced, each covered by a test
- [ ] Sidecar: least privilege tested in the production image with a render bundle that
      reads its environment, opens a TCP and a UDP socket, reads `/data`, and records the
      cookie it receives: no secrets, both sockets refused, `/data` refused where Landlock
      applies (and the image's kernel and Docker support for Landlock recorded), and only
      the per-render token, which the host refuses once the render ends
- [ ] Sidecar: the restart budget's scope chosen, per renderer or for the pool, with the
      reason recorded, and tested with a bundle that crashes on start and with one page
      that crashes every render, showing the host stops respawning and falls back to V8 or
      answers 503 for pages within the budget's window while the API keeps working
- [ ] Sidecar: a recycle under steady load measured, with no 503 while the replacement
      warms when memory allows, and several renderers crossing their RSS limit at once on
      2, 4, and 8 cores, with the cgroup's peak including the replacement; renderers and
      their descendants shown to exit when the host is killed with SIGKILL
- [ ] Sidecar: a sweep of `RENDERERS` at 1, 2, and 3 on one core and on two, with CPU,
      p95, and RSS, and the default chosen from it
- [ ] Sidecar: idle RSS, `--smol`, renderer start, and the time a recycled renderer takes to
      serve again
- [ ] Sidecar: the whole server on 1 vCPU and 2 GB under `perf:stress`, peak and idle RSS
      and CPU, against V8 after task 081.14; the memory estimate above confirmed or
      replaced
- [ ] Sidecar: the Bun upgrade check in CI, including a test that fails when the
      `oven/bun` tag and `packageManager` differ, and the image, Compose notes, and porting
      kit updated, including which budgets pick V8
- [ ] The LGPL obligations for Snowtime's images and for porting kit users checked and
      written into the porting kit, for the sidecar and for embedded JSC
- [ ] Prototype, if reopened: a JSC renderer behind the V8 renderer's interface, passing
      the render tests and hydration on all four pages
- [ ] Prototype, if reopened: CPU, p95, renderer start, and RSS at one renderer and at the
      host's renderer count, against V8 after task 081.14 and against Bun
