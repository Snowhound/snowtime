# Render garbage and V8's collector, on WSL

Date: 2026-10-06. Task 081.14, on the WSL machine of
[the engine-gap report](engine-gap-wsl.md), branch `081-render-gc` off `081-native-poc`
(`239ae15`). The app changed since task 081.13, so this task re-captured the four pages
on this branch: `render.base.js` (SHA-256 `89751a30…`) is the control bundle, and
`render.fix.js` (`abc570c8…`) adds this task's one bundle change. HTML is byte-identical
between them, and across every configuration below, on all four pages.

Measurements follow task 081.13: one CPU and 2 GiB in Docker, 50 warm-ups, 500 measured
renders, and three rounds per page with the order reversed in the second. Tables give the
mean of the three rounds. `render-gc-wsl.jsonl` holds every run.

## Result

The V8 baseline for task 081.16 is the host's chosen setting, a 32 MiB semi-space, on one
renderer:

| Page  | CPU ms | V8 workers ms |   p50 |   p95 | Peak RSS MB | Bun CPU ms | V8 / Bun |
| ----- | -----: | ------------: | ----: | ----: | ----------: | ---------: | -------: |
| timer |  15.98 |          3.19 | 13.47 | 29.18 |         189 |      10.68 |     1.50 |
| week  |  10.76 |          2.11 |  9.61 | 17.13 |         183 |       7.08 |     1.52 |
| month |  13.84 |          2.96 | 11.53 | 25.13 |         183 |       8.59 |     1.61 |
| year  |  16.92 |          3.77 | 15.56 | 31.21 |         201 |      10.40 |     1.63 |

Before this task the same pages took 17.89, 11.84, 15.25, and 18.91 ms, 1.67–1.82 times
Bun, with peak RSS of 143–160 MB. The fix saves 9–11% of V8's CPU and 4–7 ms of p95 for
30–41 MB more peak RSS on one renderer. Bun 1.4.2 ran the same captures and `render.fix.js` with
`bun-bench.ts`; its p95 is 13.8–21.1 ms and its peak RSS 154–180 MB.

V8's GC and compiler workers take 20–22% of its CPU, down from 22–24%. The rest of the gap
is the render thread, as the engine-gap report found: getter props in dictionary mode and
slow property definition.

## Why render garbage is promoted

A page allocates about 5–10 MB. With V8's default semi-space, about 4 MiB at a 128 MiB heap
limit, the timer scavenged 887 times and ran 115 mark-compacts in 551 renders.

The engine-gap report saw that about 2 MB per page survives a minor GC run after the page,
although a heap snapshot finds it dead. A diagnostic patch (`results/gc/probe.patch`)
measures this from Rust: full GC before a page, the page, a minor GC, then a full GC.
With a 32 MiB semi-space, so that no scavenge runs inside the page:

- The page's objects are dead at its end: two full GCs around it differ by 5–13 KB.
- 1.9 MB of them survives the minor GC anyway, and an immediate second minor GC promotes
  all of it.

So the scavenger treats something as a root that a full GC doesn't. Turning off
pretenuring, page promotion, Maglev and TurboFan, all JIT (`--jitless`), inline caches,
or feedback vectors doesn't change the amount (1.46–1.58 MB). A timer that stays pending
between renders would also explain it, but there isn't one. Clearing Solid's
`sharedConfig.context` is correct, and the bundle now does it, but promotion stays the
same.

Two V8 behaviours hold dead young objects across a scavenge. Both are shown with Node 24
(`acc.mjs`, `wm.mjs`): 2,000 dropped objects holding 64-element arrays, then two minor GCs.

| Holder                                         | Promoted after two minor GCs |
| ---------------------------------------------- | ---------------------------: |
| Plain property, closure, or Proxy              |                         1 KB |
| Literal getter `{ get x() { … } }`             |                      1720 KB |
| `Object.defineProperty` getter                 |                      1720 KB |
| WeakMap value that closes over its dropped key |                      1110 KB |

- **Accessors.** V8 allocates each `AccessorPair` in old space. A dead pair keeps its getter,
  the getter's closure, and everything that closure reaches, until the next mark-compact.
  Solid creates accessors for every dynamic prop: compiled getter literals (4,264 per
  timer page in the engine-gap report) and 5,880 `defineProperty` getters in `mergeProps`
  and `splitProps` per timer page.
- **WeakMap values.** The scavenger treats an old WeakMap's values as strong. The app has
  three module-level WeakMaps keyed by the page's `QueryClient` (`signals` in
  `display-format.ts`, `cachedUser` in `session.ts`) or the router; their values are
  small, so they hold little.

Because a page's objects link to one another, a few dead holders keep most of the page.
Removing accessors confirms the cause but doesn't fix it. Promotion after a minor GC at
the end of each timer page, 32 MiB semi-space:

| Bundle variant                                           | Promoted MB per page |
| -------------------------------------------------------- | -------------------: |
| Control, `sharedConfig.context` cleared                  |                 1.50 |
| Proxy-based `mergeProps` and `splitProps`                |                 1.25 |
| Compiled `createComponent` props as Proxies (lazy-props) |                 1.43 |
| Both                                                     |                 1.27 |
| Both, plus `mergeProps` and `ssrElement` literals        |                 1.22 |

The last variant defines 10 accessors per page with `defineProperty` and evaluates 241
object literals with getters, against 5,880 and thousands in the control. The year page
moves the same way, from 2.07 to 1.57 MB with both changes.

The Proxy variants cost CPU in single runs: Proxy `mergeProps` raises V8's CPU by 4–7% on
all pages, and the compiled-props rewrite saves 6–10% on month and year but nothing on
timer and week.
The engine-gap report measured that rewrite costing Bun 3–9%. Neither ships. Removing
promotion at its source needs props without accessors in Solid's server output, which is
a frontend-framework change. These partial rewrites don't bound what a complete one
would save: each leaves some accessors behind, and a few dead holders keep much of the
page.

## Heap policy

`Renderer::collect` and the replace check compared `used_heap_size`, which includes the
young generation, with `collect_heap_bytes`. They now read the old generation only
(`old_generation_bytes`: every heap space except `new_space` and
`new_large_object_space`). The engine-gap report found that with the old check a 32 MiB
semi-space ran `low_memory_notification` after every year page and raised its CPU to
22.7 ms; with the new one the year page takes 16.92 ms at 32 MiB. At V8's default
semi-space, this task's code (policy and cleared context) is neutral: 17.71 vs 17.89 ms on
the timer, the other pages within 0.3 ms.

## Semi-space size

`Policy::semi_space_bytes` sets V8's initial and maximum young generation to three
semi-spaces, the size V8 itself uses. The old generation keeps the limit V8 derives from
`heap_limit_bytes`, so a set semi-space raises the whole heap's limit: at 128 MiB and
32 MiB it may reach about 212 MiB. Keeping the total at 128 MiB would leave the old
generation about 30 MiB; the runaway-page guard is the old generation's limit, which
doesn't change. The semi-space behaves like `--min-semi-space-size` and
`--max-semi-space-size` with equal values: 157 and 150 scavenges in the same timer run.

One renderer, one CPU:

| Page  | Semi-space | CPU ms | Workers | p95 ms | Peak RSS MB |
| ----- | ---------- | -----: | ------: | -----: | ----------: |
| timer | control    |  17.89 |    3.89 |  33.81 |         157 |
| timer | default    |  17.71 |    3.85 |  32.93 |         148 |
| timer | 4 MiB      |  17.65 |    3.83 |  33.85 |         149 |
| timer | 8 MiB      |  17.28 |    3.69 |  34.00 |         150 |
| timer | 16 MiB     |  16.61 |    3.18 |  28.85 |         172 |
| timer | 32 MiB     |  15.98 |    3.19 |  29.18 |         189 |
| week  | control    |  11.84 |    2.61 |  21.30 |         143 |
| week  | default    |  11.53 |    2.52 |  21.09 |         133 |
| week  | 4 MiB      |  11.54 |    2.53 |  21.65 |         135 |
| week  | 8 MiB      |  11.29 |    2.39 |  21.42 |         141 |
| week  | 16 MiB     |  10.84 |    2.16 |  20.07 |         152 |
| week  | 32 MiB     |  10.76 |    2.11 |  17.13 |         183 |
| month | control    |  15.25 |    3.58 |  32.23 |         153 |
| month | default    |  15.24 |    3.57 |  31.54 |         142 |
| month | 4 MiB      |  15.12 |    3.51 |  31.44 |         141 |
| month | 8 MiB      |  14.83 |    3.41 |  30.84 |         147 |
| month | 16 MiB     |  13.94 |    2.93 |  26.82 |         164 |
| month | 32 MiB     |  13.84 |    2.96 |  25.13 |         183 |
| year  | control    |  18.91 |    4.51 |  37.02 |         160 |
| year  | default    |  18.89 |    4.52 |  37.74 |         150 |
| year  | 4 MiB      |  18.82 |    4.45 |  37.05 |         147 |
| year  | 8 MiB      |  18.10 |    4.59 |  37.44 |         157 |
| year  | 16 MiB     |  17.89 |    4.50 |  37.73 |         163 |
| year  | 32 MiB     |  16.92 |    3.77 |  31.21 |         201 |

"Control" is the old bundle and policy; "default" is this task's code with V8's sizing.
Clearing `sharedConfig.context` lowers peak RSS by about 10 MB.

Four renderers, four clients, four CPUs, 2 GiB, 1,000 renders. A host with 2 GiB and four
CPUs runs four renderers. CPU is per page across the process:

| Page  | Semi-space | CPU ms | p95 ms | Peak RSS MB | Pages/s |
| ----- | ---------- | -----: | -----: | ----------: | ------: |
| timer | control    |  21.47 |  42.46 |         262 |     187 |
| timer | default    |  20.91 |  42.11 |         265 |     193 |
| timer | 8 MiB      |  21.27 |  43.30 |         287 |     189 |
| timer | 16 MiB     |  19.67 |  40.80 |         351 |     204 |
| timer | 32 MiB     |  19.28 |  40.02 |         458 |     208 |
| week  | control    |  13.76 |  31.30 |         232 |     293 |
| week  | default    |  13.94 |  32.05 |         233 |     289 |
| week  | 8 MiB      |  13.50 |  31.09 |         260 |     298 |
| week  | 16 MiB     |  12.98 |  30.90 |         318 |     311 |
| week  | 32 MiB     |  12.63 |  28.58 |         424 |     319 |
| month | control    |  18.21 |  40.93 |         255 |     221 |
| month | default    |  18.31 |  41.36 |         254 |     220 |
| month | 8 MiB      |  18.15 |  41.22 |         275 |     222 |
| month | 16 MiB     |  17.04 |  37.86 |         347 |     236 |
| month | 32 MiB     |  16.82 |  38.33 |         447 |     239 |
| year  | control    |  22.66 |  46.53 |         272 |     177 |
| year  | default    |  22.31 |  46.81 |         283 |     180 |
| year  | 8 MiB      |  21.78 |  45.97 |         291 |     185 |
| year  | 16 MiB     |  21.66 |  46.68 |         335 |     186 |
| year  | 32 MiB     |  20.68 |  44.15 |         488 |     195 |

A 4 MiB semi-space ran in a separate sweep on 2026-10-07, alternating with its own
default control. It is within noise of V8's default on all four pages: CPU from −3.4% (week)
to +0.4% (year), peak RSS within 7 MB. That sweep's default ran 5–8% slower than the one
above, so its numbers aren't comparable with the table, only with each other.

A 32 MiB semi-space saves 8–11% of CPU at one and at four renderers and adds about 50 MB
of peak RSS per renderer; 16 MiB saves 3–8% for about 20 MB. Below 16 MiB a page no longer
fits in the nursery and the savings vanish. At a 32 MiB semi-space the young generation
holds a whole page, so scavenges drop from 887 to 145 and mark-compacts from 115 to 74 in
551 timer renders (week, month, and year fall by similar shares). A forced minor GC after
the page promotes 1.1–2.1 MB, as much as before or more, because the page's survivors now
reach that GC unpromoted: the holders above remain, so the fix lowers how often V8
collects, not what each page leaves behind.

The host chooses the size (`crates/host/src/memory.rs`): after sizing the renderers, it
gives each a 32 MiB semi-space if the planned memory left covers 56 MiB per renderer,
else 16 MiB if it covers 24 MiB, else V8's default. Four renderers at 32 MiB peak at
424–488 MB, well inside the 1,536 MiB the host plans to use of 2 GiB. A 1 GiB host with
four CPUs gets 32 MiB; 384 and 512 MiB hosts get 16 MiB; a 256 MiB host, and a host whose renderer count uses all of its memory,
keep V8's default.

## Rejected

Three rounds on timer and year with a 32 MiB semi-space, then all four pages where a flag
won on both:

| Change                                    | Timer CPU | Year CPU | Result                         |
| ----------------------------------------- | --------: | -------: | ------------------------------ |
| None                                      |     16.33 |    16.97 |                                |
| Minor GC after each page                  |     17.75 |    18.46 | +9%; peak RSS −45 MB           |
| `--no-minor-gc-task`                      |     15.92 |    16.33 | mixed on four pages, see below |
| `--minor-gc-task-trigger=95`              |     16.16 |    16.54 | smaller than the above         |
| `--scavenger-precise-object-pinning`      |     16.09 |    17.10 | noise                          |
| `--scavenger-conservative-object-pinning` |     16.06 |    16.97 | noise                          |
| `--no-page-promotion`                     |     16.15 |    16.95 | noise                          |
| `--page-promotion-threshold=90`           |     16.21 |    16.88 | noise                          |
| `--single-generation`                     |     16.23 |    17.01 | noise                          |

The minor GC after each page is `request_garbage_collection_for_testing`, which also
needs `--expose-gc`; it loses on both pages, so it isn't kept.
`--scavenger-max-new-space-capacity-mb` doesn't exist in this V8 (`v8` 149.4).

`--no-minor-gc-task` on all four pages saves 0.9–2.8% at 32 MiB, within the timer's range,
and adds about 10 MB of peak RSS there; at 16 MiB it raises timer and month CPU by 0.7%
and 1.6%. It isn't a consistent win, so V8's flags stay at their defaults.

## Reproduction

Scripts, raw outputs, bundle variants, and allocation profiles are in the ignored
`native/crates/render/results/gc/` of `/root/snowtime-gc` on the WSL machine.
`scripts/sweep.sh` runs alternating rounds of `render-bench` configurations and compares
HTML; `table.py` summarizes them. `RENDER_SEMI_MB` sets the semi-space in `render-bench`.
`probe.patch` adds `RENDER_GC_PROBE` (minor, full, and live-set measurements after each
page) and survivor-only allocation sampling. `variant.py`, `mp.py`, `lazy2.mjs`,
`count.py`, `getcount.mjs`, and `wm.py` derive the bundle variants above.
