# Where the V8 renderer loses to Bun, on WSL

Date: 2026-10-06. Baseline: `ff6e340` on `081-render-web-apis`, the selected bundle of task
081.13 (`render.js` SHA-256 `5a68014a…`). Same machine, fixtures, and limits as
[the allocation report](render-allocations-wsl.md): one CPU, 2 GiB, 50 warm-ups, 500
measured renders. Single runs unless a row says otherwise; differences under about 3% are
noise.

Task 081.13 split V8's CPU into profiler buckets and trimmed a few of them. This pass asks
where the time goes relative to Bun instead, by changing one thing at a time.

## Results

### The embedding is not the cause

The same bundle and answers, run by stock runtimes (CPU ms per render, timer page):

| Runtime               |   CPU |
| --------------------- | ----: |
| Bun 1.4.2             | 10.06 |
| The render crate (V8) | 17.25 |
| Node 24 (V8 13.6)     | 18.17 |
| Node 22               | 20.60 |

Node runs `bun-bench.ts` with `import.meta.dir` and `Bun.sleep` replaced
(`node-bench.ts`). The crate is already faster than stock Node, so its ops, snapshot, and
event loop don't explain the gap.

The "Bun with JS polyfills" reference of task 081.12 is not a fair engine comparison: its
`encodeInto` shim encodes the page one character at a time.

### The gap is in Solid's synchronous render

Timers added to the bundle (`phases.py`) split each render into A, the request, router
load, and API calls up to `renderToStream`; B, Solid's synchronous `createRoot(...)`
render of the page; and C, the shell, serialization, and streaming. Wall ms per render,
renders 100–500:

| Page  | Engine |    A |     B |    C | Total |
| ----- | ------ | ---: | ----: | ---: | ----: |
| timer | V8     | 1.08 | 12.70 | 3.63 | 17.41 |
| timer | Bun    | 0.82 |  7.30 | 2.27 | 10.39 |
| year  | V8     | 2.86 | 11.06 | 4.34 | 18.25 |
| year  | Bun    | 1.78 |  6.20 | 3.07 | 11.05 |

B holds 67–77% of the gap. It calls no web APIs: it is the app's components running in
Solid. Web APIs and streams can account for at most C's 1.3–1.4 ms.

### V8 spends a quarter of its CPU on background GC

`thread_cpu_ms` (added to `render-bench`) splits the measured CPU by thread:

| Page  | Total | Render thread | V8 workers |
| ----- | ----: | ------------: | ---------: |
| timer | 17.34 |         13.38 |       3.90 |
| year  | 18.48 |         14.02 |       4.40 |

The workers' time is user time, and task 081.13's perf data shows it is almost all
concurrent marking, scavenging, and sweeping; compilation is a sliver. Bun's JIT threads
take 15–23% of its samples (task 081.13), so GC workers explain roughly 2 ms of the gap,
and the render thread the rest.

### Dead render objects are promoted

With `--trace-gc`, the timer scavenges about three times per render and promotes about
half of each render's ~8 MB, so a full mark-compact runs every ~5 renders. A minor GC
requested after each render settles (from Rust, `request_garbage_collection_for_testing`)
still promotes about 2.5 MB per render in the crate and 1.34 MB in Node, every render.

Two heap snapshots one render apart show only 0.13 MB of that render still alive. The
rest is dead when it is promoted. Old-space objects written during the render hold
pointers into the young generation, and the scavenger treats those as roots. Which
objects these are is still open. Disabling pretenuring, MinorMS, and object pinning
don't change it, or make CPU worse.

Solid's module-level `sharedConfig.context` also keeps the last render's whole graph
(context, router, query client) alive until the next render. Clearing it at the end of
`renderPage` is correct, but alone doesn't change the promoted amount.

### Nursery size helps, but the heap policy fights it

| Timer, V8 flags                                              |   CPU | Scavenges / MCs, 400 renders |
| ------------------------------------------------------------ | ----: | ---------------------------: |
| Default (about 4 MB semi-space)                              | 17.90 |                     635 / 80 |
| `--min-semi-space-size=32 --max-semi-space-size=32`          | 17.05 |                      98 / 49 |
| The same, with `--initial-old-space-size=1500` and 2 GB heap | 16.50 |                      126 / 2 |

On the year page, a 32 MB semi-space raised CPU from about 18.5–19.0 to 22.7 ms. `Renderer::collect`
compares `used_heap_size`, which includes the young generation, with `collect_heap_bytes`
(48 MiB), so a larger nursery forces `low_memory_notification` after every page.

### V8's optimizing tier gains little on this code

| Change                     | CPU (timer) |
| -------------------------- | ----------: |
| Bun                        |       10.01 |
| Bun, `BUN_JSC_useFTLJIT=0` |        9.10 |
| Bun, `BUN_JSC_useDFGJIT=0` |       15.90 |
| V8                         |       17.39 |
| V8, `--no-turbofan`        |       18.29 |
| V8, `--no-maglev`          |       17.79 |

JSC's DFG tier is worth 37% to Bun; TurboFan is worth 5% to V8. Between renders 100 and
500 V8 still compiles about 2.7 functions per render with only three deopts. Code and
bytecode flushing flags, lazy feedback allocation, and making full GCs rare don't stop
those compiles; their cause is open, and they cost well under 1 ms per render.

### Getter props are slow to create in V8

Solid's compiler emits `createComponent(C, { get prop() { … } })` for dynamic props:
1,123 such objects and 4,264 getters per timer render, 3,803 and 9,449 per year render.
V8 creates objects with accessors through runtime calls and keeps them in dictionary
mode. One million three-prop objects (`lit.mjs`):

| Object                       | V8 (Node 24) |   Bun |
| ---------------------------- | -----------: | ----: |
| Literal with two getters     |       528 ms | 47 ms |
| Literal with function values |        15 ms | 12 ms |

Solid's server `mergeProps` and `splitProps` hit the same paths (`props-micro.mjs`: 9.0 s
on V8, 1.7 s on Bun). `lazy-props.mjs` rewrites 1,114 compiled sites to a Proxy over
thunks. HTML stays byte-identical on all four pages. Over three alternating rounds it
changes V8 CPU by 0% (timer), −0.3 to −2.5% (week), −5% (month), and −6 to −10% (year),
and costs Bun 3–9%.

### Ruled out

Each of these changed CPU by less than the noise, or made it worse:

- The fixture's `Date` Proxy, reinstalled every render (`clock.py`): no change on either
  engine.
- tailwind-merge: 0.26–0.56 ms per render, with its cache hitting.
- `--no-flush-bytecode`, `--no-flush-baseline-code`, `--no-lazy-feedback-allocation`.
- `--minor-ms`: +60% CPU. `--single-threaded`, `--single-threaded-gc`: slower in total.
- Compiler, LLVM, and SIMD: the hot code is JIT output, and the crate's V8 (`v8` 149.4) is
  newer than Node 24's.

## What the gap is made of

On the timer, V8 uses about 7.3 ms more CPU than Bun. About 2 ms is background GC of
render garbage that should have died young. The rest is the render thread running Solid's
component code about 1.7 times slower: dictionary-mode props, slow-path property
definition, and an optimizing tier that rarely pays off. Fixing promotion, the heap
policy, and props creation should recover part of it; this report's estimate is that V8
stays at about 1.4–1.5 times Bun's CPU.
Task 081.14 measured 1.50–1.63 times after its GC changes
([report](render-gc-wsl.md)).

## Reproduction

The scripts and raw outputs are in the ignored
`native/crates/render/results/engine-gap/` of the `/root/snowtime-gc` worktree on the WSL
machine (`raw/` holds traces and heap snapshots). They read the captures in
`/root/snowtime/native/crates/render/results/`. `run.sh`, `quick.sh`, and `ab.sh` run the
crate and Bun; `phases.py`, `lazy-props.mjs`, `clock.py`, and `clear2.py` derive bundle
variants from `render.orig.js`; `snapdiff.py` diffs two heap snapshots.
