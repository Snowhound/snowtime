# 081.01: Server rendering in the native backend

Status: in-progress (spike measured 2026-10-02; Linux numbers and the render API open)

The native backend renders pages and the browser hydrates them, as it does with today's
Start server. Rust embeds a V8 isolate that runs the app's Solid server render. Kait chose
this on 2026-10-02 over task 079's shells: a shell's warm load shows content 430–480 ms
later than a server-rendered page (task 079, "Measured"), and the spike below found
rendering cheap and hydration compatible. Task 079 is cancelled.

## Findings

All numbers are from one Apple M-series Mac, on the Lumen Works seed, on three pages: the
timer, the week report, and the year report (384 KB of HTML). Render times are medians of
500 renders after 50 warm-up renders, in one context. The data is in
[server-rendering/](server-rendering/), and the spike's write-up is
[spike-results.md](server-rendering/spike-results.md).

- **Start's client hydrates HTML that a non-Start server renders.** One bundle,
  `render.js` (2.6 MB, no Node APIs, no Start runtime), renders the routes from a
  pre-seeded query cache without calling a server function. Its body markup is identical
  to Start's own SSR on all three pages, every `data-hk` hydration key included. In
  Chrome, Start's client hydrates it with no errors, and client-side navigation works.
  The server supplies the URL, the query data as JSON, the locale, a nonce, and the
  client manifest from Start's build. Route components must be split the way Start's
  build splits them, or every hydration key below a split route is off by one level.
- **Rendering is cheap.** With a JIT, a render takes 4–19 ms of CPU. Today's Start server
  spends 18–52 ms of CPU per page load including the reads (`perf:load`, task 079).
- **The live heap is about 15 MB.** With a full GC every 10 renders, V8's heap stays at
  15–17 MB and the process's samples at 66–118 MB, with render time unchanged and CPU per
  render 20% higher. The peak RSS of that run was still 219 MB, for a reason not yet
  found. Left alone, V8 grows its heap to 60–130 MB and the process to 200–260 MB
  over 500 back-to-back renders, because nothing pressures it to collect. RSS and macOS's
  memory footprint (`phys_footprint`) agree within a few MB, so the growth is real memory.
- **Text depends on the engine's locale data.** On the week report, V8 (ICU 78) writes
  "28 Mon" where Bun on macOS writes "Mon 28". "Mon 28" comes from macOS's ICU
  (`libicucore`), which Bun and the system JavaScriptCore use there. On Linux, Bun 1.4.2
  and Bun's JavaScriptCore carry their own ICU 78 and write "28 Mon", byte-equal to V8
  on all three pages, as do Node 24 and Chrome. Hydration doesn't patch static text.

### Engines

Week and year report, from [engines.md](server-rendering/engines.md):

| Engine                                    | Startup ms | Render p50, week / year ms | RSS loaded → peak MB | Output                             |
| ----------------------------------------- | ---------: | -------------------------: | -------------------: | ---------------------------------- |
| Bun 1.4.2                                 |         46 |                  3.6 / 6.2 |             43 → 260 | Reference                          |
| V8 15.2 (`v8` crate)                      |         48 |                 6.1 / 16.6 |             53 → 265 | Equal; ICU text on the week report |
| V8 from a startup snapshot                |        7.6 |                 6.2 / 16.7 |           28.5 → 266 | Same as V8                         |
| JavaScriptCore, macOS framework, JIT      |         60 |                 8.0 / 17.0 |             47 → 407 | Equal                              |
| JavaScriptCore, no JIT                    |         63 |                   48 / 116 |              43 → 77 | Equal                              |
| Bun's WebKit (JSC linked statically, JIT) |         55 |                  4.8 / 8.9 |             52 → 399 | Equal                              |
| SpiderMonkey 153 (`mozjs`)                |         97 |                 6.7 / 12.2 |             55 → 348 | Equal; ICU text on the week report |
| QuickJS-ng with FormatJS `Intl`           |       ~500 |                  327 / 649 |             71 → 121 | ICU text on the week report        |
| Boa 0.22                                  |      1,630 |                ~355 / ~397 |            205 → 217 | Wrong: renders the error page      |
| Perry 0.5.1520                            |          — |                          — |                    — | Doesn't compile (task 081.04)      |

Recommended: V8. It renders within 2–3× of Bun's time, its startup snapshot creates a
context in 7 ms, it ships prebuilt static libraries for Linux, and it formats text with
Chrome's locale data. SpiderMonkey is
as fast but uses more memory and builds a 37 MB library. The macOS JavaScriptCore runs
its JIT only in a binary signed with the `allow-jit` entitlement. Bun's WebKit build
matches V8 on Linux and doesn't change the recommendation ([Bun's WebKit](#buns-webkit)).

### Bun's WebKit

Bun's JavaScriptCore, linked statically into the Rust harness, renders as fast as Bun
running the same JS polyfills. Bun's lead over it comes from Bun's native `URL`,
`TextEncoder`, and streams, not from its engine. On Linux it renders the week and year
reports in 7.8 / 18.3 ms, against V8's 7.6 / 20.4 ms. With a full GC every 10 renders it
holds more memory than V8 does, and the GC costs it less CPU.

Linux numbers are from Docker on the same Mac (`debian:trixie-slim`, `--cpus=1
--memory=2g`), medians of 3 runs of 500 renders after 50 warm-up renders:

| Engine, Linux                  | Startup ms | p50 timer / week / year ms | CPU ms/render, year | RSS samples, year MB | Peak, year MB |
| ------------------------------ | ---------: | -------------------------: | ------------------: | -------------------: | ------------: |
| Bun 1.4.2                      |         62 |            9.2 / 5.4 / 9.8 |                13.3 |              139–188 |           188 |
| Bun, polyfills forced          |         64 |          12.4 / 6.8 / 17.6 |                21.0 |              176–223 |           214 |
| Bun's WebKit                   |         93 |          13.5 / 7.8 / 18.3 |                21.1 |              173–203 |           203 |
| Bun's WebKit, full GC every 10 |         99 |          14.5 / 7.9 / 20.1 |                22.8 |              140–182 |           188 |
| V8 15.2                        |         74 |          13.9 / 7.6 / 20.4 |                24.2 |              195–228 |           255 |
| V8, full GC every 10           |        104 |         21.0 / 12.8 / 30.6 |                36.3 |              103–126 |           237 |

- **Build.** Release `autobuild-a0ec3b71e169ede2740b172eef33a150a32d6a7e` (2026-10-02),
  `bun-webkit-macos-arm64` and `bun-webkit-linux-arm64`. They ship `libJavaScriptCore.a`
  (617 MB on macOS, 653 MB on Linux), `libWTF.a`, `libbmalloc.a`, and the public C API
  headers (`JavaScript.h`, `JSContextRef.h`, and the `*Private.h` ones). The Linux build
  adds ICU 78 (`libicu*.a`, 67 MB); the macOS build uses the system's `libicucore`.
- **Linking.** The host supplies what Bun links itself: mimalloc from Bun's fork (commit
  `eab09015`, Bun's defines), and on Linux the zstd hook through which Bun's patched ICU
  reads its compressed display-name data (`bun_icu_maybe_decompress`). Without the hook,
  every `Intl` constructor throws and the page renders as an error. Bun's event-loop hooks
  (`WTFTimer__*`) are weak, so WTF falls back to its generic run loop. The LTO archives
  hold LLVM 23 bitcode, which Xcode's linker (LLVM 21) can't read; the numbers are from
  the non-LTO build. No `JSC::initialize` or other C++ setup is needed.
- **Fork differences.** Bun's fork removes the API lock from most GC and context functions
  (`JSBase.cpp` keeps 2 of upstream's 8 `JSLockHolder`s, `JSContextRef.cpp` 16 of 23); the
  object and value functions keep theirs. A synchronous GC through
  `JSSynchronousGarbageCollectForDebugging` crashes unless the host takes the lock,
  through the mangled `JSC::JSLockHolder` constructor. `JSGetMemoryUsageStatistics`
  returns NaN fields and crashes after a few calls. Options go through the mangled
  `JSC::Options::setOptions`.
- **JIT.** It runs unsigned on macOS. Signed with the hardened runtime it needs the
  `allow-jit` entitlement, as the system framework does; without it, it runs in the
  interpreter (80 ms CPU per week report). Linux needs nothing.
- **Memory.** On Linux, a full GC every 10 renders costs 8% more CPU per render; V8's
  costs 50%. On macOS that GC holds the year report's memory footprint at 79–114 MB (V8:
  106–123), but RSS stays at 217–273 MB, because RSS counts pages mimalloc has marked
  reusable. On Linux, RSS drops only to 140–182 MB. `MIMALLOC_PURGE_DELAY=0` lowers it to
  122–141 MB, and a GC after every render with `WTF::releaseFastMallocFreeMemory` to
  103–115 MB at 31.6 ms per year report. A new context with the bundle evaluated takes
  15 ms (V8 without a snapshot: 64–73 ms).
- **Bun's options.** Bun sets `heapGrowthSteepnessFactor=1.0`,
  `heapGrowthMaxIncrease=2.0`, and `largeHeapSize=8 MB` at startup. On macOS they lower
  the year report's footprint from 248 to 192 MB and slow it by 7%; on Linux they change
  neither. `useConcurrentJIT=false numberOfGCMarkers=1` (Bun's one-shot mode) raises the
  year report's p95 from 12 to 18 ms on macOS. `useFTLJIT=false` costs 23% on the year
  report and `useDFGJIT=false` 2.5× (single runs of 300 renders).
- **Size.** The Linux binary is 54 MB, 45 MB stripped, ICU included (V8: 66 MB, 48 MB
  stripped); the macOS one is 35 MB, 28 MB stripped. The crate builds and links in 4 s on
  macOS and 10–12 s on Linux; mimalloc compiles in 4 s.
- **License.** JavaScriptCore and WTF are mostly LGPL 2.1 with BSD files; bmalloc is BSD,
  ICU is under the Unicode license, mimalloc MIT, zstd BSD. Running the server as a
  service triggers nothing, but publishing the Docker image distributes the binary. Static
  linking then requires offering JavaScriptCore's source with Bun's changes (the
  `oven-sh/WebKit` commit), the license texts, and a way to relink the program with a
  changed JavaScriptCore. Snowtime's MIT source meets the last, if the build stays
  reproducible.

V8 stays the recommendation. On Linux the two render at the same speed. V8's startup
snapshot, heap limits, and near-heap-limit callback come with a maintained Rust crate and
a BSD license, and on Linux V8 holds 40–55 MB less RSS with a GC every 10 renders. Bun's
build has no versioned releases and no stable embedding API: the harness depends on
mangled C++ symbols, the fork's changed locking, and two hooks Bun normally supplies.
Bun's WebKit would be the better choice if GC CPU mattered more than memory, or if fresh
contexts without a snapshot were needed.

### V8 heap limits

Old-space cap against semi-space size, year report, V8 from the snapshot, two runs each
([v8-heap-sweep.jsonl](server-rendering/v8-heap-sweep.jsonl)):

| Old space cap MB | Semi-space 1 MB: p50 / CPU ms, peak MB | Semi-space 16 MB: p50 / CPU ms, peak MB |
| ---------------: | -------------------------------------- | --------------------------------------- |
|               32 | 33.3 / 49.8, 136                       | out of memory                           |
|               48 | 28.6 / 42.7, 151                       | 18.5 / 24.1, 169                        |
|               64 | 29.9 / 45.0, 162                       | 18.6 / 23.2, 186                        |
|               96 | 30.9 / 46.8, 177                       | 18.6 / 23.1, 193                        |
|              128 | 31.0 / 47.0, 166                       | 18.7 / 23.0, 196                        |
|             none | 28.0 / 38.5, 188                       | 18.7 / 22.8, 215                        |

A 1 MB young generation doubles the CPU per render; the old-space cap barely changes
speed. The cap lowers the peak by 30–50 MB at most, because V8's heap is under half of
the process's memory.

### V8 flags

With a 16 MB semi-space, year report ([v8-flags.txt](server-rendering/v8-flags.txt)):

| Flags                                                           | p50 ms | CPU ms/render |                        RSS end / peak MB |
| --------------------------------------------------------------- | -----: | ------------: | ---------------------------------------: |
| none                                                            |   18.3 |          22.1 |                                204 / 216 |
| `--max-opt=2` (no TurboFan)                                     |   27.5 |          31.8 |                                196 / 207 |
| `--max-opt=1` (Sparkplug only)                                  |   57.7 |          61.2 |                                108 / 128 |
| `--optimize-for-size`                                           |   31.9 |          48.1 |                                152 / 184 |
| `--lite-mode`                                                   |   98.2 |         111.8 |                                  44 / 69 |
| `--jitless`                                                     |   84.6 |          88.2 |                                 91 / 124 |
| `--single-threaded`                                             |   20.3 |          21.7 |                                229 / 253 |
| Full GC every 10 renders (host calls `low_memory_notification`) |   18.9 |          26.5 | 118 / 219 (samples 66–81 until the last) |

GC scheduling is the lever. Disabling compiler tiers costs 1.5–5× the CPU for less memory
than a GC every few renders saves.

### Runtime tuning

The host can tune memory while the server runs:

- `low_memory_notification()` runs a full GC and returns memory; the measurements above
  call it after a render. `memory_pressure_notification()` asks for the same in steps.
- A near-heap-limit callback can raise the cap instead of crashing.
- A new isolate from the snapshot takes 7 ms, so the server can replace one whose memory
  has grown.

The heap cap and the semi-space size are set when an isolate is created. Changing them
means creating a new isolate.

## Planned

Kait agreed to both on 2026-10-03:

- **Native web APIs in the host.** Bun renders faster than the embedded engines because
  its `URL`, `TextEncoder`/`TextDecoder`, and streams are native. With the same JS
  polyfills, Bun, Bun's JavaScriptCore, and V8 render at the same speed (see
  [Bun's WebKit](#buns-webkit)), and the polyfills cost 30–45% of render time. The host
  implements those APIs natively, or the render bundle stops needing them. Candidates
  to start from: Deno's extension crates for V8 (`deno_url`, `deno_web`, `deno_webidl`,
  MIT), the `ada-url` crate (the URL parser Node and Bun use), and Bun's implementations,
  which are tied to JavaScriptCore but show what the bundle needs.
- **A GC policy driven by idle time and memory, not a fixed count.** A full GC every 10
  renders adds 50% CPU on V8 on Linux (20% on macOS, 8% on JavaScriptCore). The host
  collects when the isolate is idle, or when its memory crosses a threshold, and
  replaces the isolate from the snapshot if memory still grows.

## Open

- Most numbers are from macOS. Linux, on one core, in task 078's Docker limits, is what
  counts, and its allocator returns memory differently. The render loop has been run in
  Docker on the Mac ([Bun's WebKit](#buns-webkit)), not on a Linux host or under load.
- The render API: one isolate per worker thread or one for the process, GC after idle
  time or every N renders, and what the server does when a render throws or exceeds a
  time limit.
- The memory target. 081's 64 MB was set for an API-only server. V8 from a snapshot adds
  28.5 MB before the first render and runs at 66–118 MB with frequent GC on macOS, with
  an unexplained 219 MB peak.
- The peak. V8 peaked at 237 MB on Linux and 219 MB on macOS in runs whose samples stayed
  at 103–126 MB and 66–118 MB. Its cause is unknown.

## Acceptance criteria

- [ ] V8 measured on Linux in task 078's container limits: RSS at idle and under load,
      CPU per render, with the GC policy chosen
- [ ] A render API in the proof of concept: Rust serves the timer and week report
      server-rendered, and Start's client hydrates them
- [ ] A memory target for the native backend with a renderer, agreed with Kait
- [ ] The decision recorded in `docs/architecture/` with what was rejected: shells
      (task 079), a separate Bun render process, and the other engines
- [ ] The spike's harness kept where it can be re-run (it's in the gitignored
      `temp/ssr-spike/` of the `snowtime-ssr-spike` worktree)
