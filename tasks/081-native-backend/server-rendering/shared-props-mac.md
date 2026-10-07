# Shared own accessor props on the Mac

Date: 2026-10-07. Task 081.20, branch `081-native-poc`, based on `55b1ab1`. Measured on an
Apple M1 Pro (10 cores, 32 GiB) in Docker Desktop's Linux VM. Each container gets one CPU
and 2 GiB. The app was rebuilt and recaptured in this session.

Task 081.19 measured on the WSL machine. Absolute times here aren't comparable to its
report, so this report compares relative changes only.

## Decision

V8 uses the **shared** bundle and Bun keeps the **plain** one:

- V8: shared takes 3–22% off render CPU on every page at both semi-space settings, and
  lowers p95, peak RSS, and promotion.
- Bun: shared costs 10–21% more CPU.
- Task 081.19's prototype bundle is removed. It lost to plain on V8's timer and week
  pages and on every Bun page.

V8's best bundle is still 1.26–1.38 times Bun's plain bundle in render CPU, above the 1.2
target. [Closing the engine gap](#closing-the-engine-gap) lists what was tried, and task
081.21 continues.

## Gate: map and accessor sharing

`native/crates/render/bundle/bench/accessor-shapes.js` creates 1,000,000 objects with two
lazy getters over fresh closures and one data prop. The promotion columns create 2,000
objects, drop them, and measure old-space growth after one minor GC and after two. Times
are the minimum of three runs.

| Engine               | Layout               | Create | Fast mode, same map | Old space after 1 minor | After 2 minors |
| -------------------- | -------------------- | -----: | ------------------- | ----------------------: | -------------: |
| V8 13.6 (Node 24)    | getter literal       | 254 ms | no, yes             |                   94 KB |         696 KB |
|                      | prototype getters    |  16 ms | yes, yes            |                    0 KB |          47 KB |
|                      | shared own accessors | 175 ms | yes, yes            |                    0 KB |          47 KB |
| V8 15.0 (Deno 2.9.7) | getter literal       | 244 ms | no, yes             |                   94 KB |         694 KB |
|                      | prototype getters    |  14 ms | yes, yes            |                    1 KB |          45 KB |
|                      | shared own accessors | 316 ms | yes, yes            |                    1 KB |          46 KB |
| JSC (Bun 1.4.2)      | getter literal       |  47 ms | same structure      |                       — |              — |
|                      | prototype getters    |  16 ms | same structure      |                       — |              — |
|                      | shared own accessors |  78 ms | same structure      |                       — |              — |

The gate passes. V8 keeps shared-accessor objects in fast mode on one map, so they share
its accessor pairs. It allocates nothing for them directly in old space, and promotes no
more than for prototype getters.

Creation is slower than prototype getters, because each `defineProperty` is a runtime
call. On V8 15.0 it's also slower than a getter literal. The render crate's V8 (rusty_v8
149, V8 14.9) took 286 ms for literals and 167 ms for shared accessors in the same loop.

## Implementation

`bundle/shared-props.ts` reuses task 081.19's site detection and fallbacks. It rewrites
**1,331 sites and skips none**, with **246 shared descriptors**, one per getter key.
Each site gets a constructor that does three things:

- stores each getter's closure in a symbol slot
- defines the accessor from the key's descriptor
- assigns the data props in literal order

The constructor's `prototype` is `Object.prototype`. Own string keys, key order,
descriptor flags, and the prototype match the literal. The slots are enumerable symbols,
as in Solid 2.0, so a spread or `Object.assign` also copies them.

`bundle/shared-runtime.js` replaces Solid's server `mergeProps` and `splitProps`:

- `mergeProps` stores its sources in a slot and defines each key from one cached
  descriptor per key, instead of a closure per key per call.
- `splitProps` re-homes a shared getter to a cached descriptor that reads the split
  source, so the copy still reads through the right receiver. It copies plain data props
  by assignment and keeps its descriptor map in fast mode.

`bundle/shared-props.test.ts` checks:

- own keys, key order, flags, and the prototype
- laziness, live bindings, and descriptor sharing across sites
- merge fallback, re-homed copies, nested splits, proxies, and symbols
- the fallbacks

### Adapters

None of task 081.19's adapters for enumeration, spread, rest, or `for…in` is needed. Of the
743 operations in [its audit](prototype-props-audit.jsonl), only two take a descriptor
from props and define it on another object:

| Audit row (bundled line)       | Operation                                 | Handling                                                      |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------------- |
| 293, Solid server `mergeProps` | `Reflect.ownKeys(Object(source))`         | Replaced by the shared runtime, which skips symbol slots      |
| 314, Solid server `splitProps` | `Object.getOwnPropertyDescriptors(props)` | Replaced by the shared runtime, which re-homes shared getters |

better-fetch's descriptor copies (rows 41597–41608) handle fetch options, not props.
`Error.stackTraceLimit` (row 40907) and seroval's `getOwnPropertyNames` reads (rows 601
and 6773) don't touch props. The bundle has no `getOwnPropertySymbols` call.

## Timing and memory

All three bundles ran in one session. Each run is 50 warm-ups and 500 measured renders,
with one renderer and one client. There are three rounds per page, and round 2 reverses
the order. Values are means of the three runs. All 108 runs produced HTML byte-identical
to the same engine's plain run. [The raw runs and bundle hashes](shared-props-mac.jsonl)
are kept.

| Engine / semi-space | Page  | CPU ms, plain → prototype → shared |                p95 ms |     Peak RSS MB | Prototype | Shared |
| ------------------- | ----- | ---------------------------------: | --------------------: | --------------: | --------: | -----: |
| v8-default          | timer |              18.27 → 19.16 → 15.19 | 36.47 → 35.22 → 27.40 | 148 → 142 → 126 |     +4.9% | −16.9% |
| v8-default          | week  |              12.02 → 12.19 → 10.66 | 22.42 → 19.55 → 14.40 | 134 → 145 → 123 |     +1.4% | −11.3% |
| v8-default          | month |              16.67 → 16.43 → 13.59 | 35.78 → 30.59 → 22.29 | 141 → 140 → 130 |     −1.4% | −18.5% |
| v8-default          | year  |              20.88 → 18.42 → 16.33 | 40.68 → 35.65 → 29.90 | 144 → 147 → 132 |    −11.8% | −21.8% |
| v8-32               | timer |              15.91 → 17.67 → 13.99 | 31.09 → 35.84 → 25.08 | 192 → 191 → 172 |    +11.0% | −12.1% |
| v8-32               | week  |              10.72 → 11.47 → 10.41 | 15.91 → 19.15 → 15.68 | 183 → 193 → 171 |     +7.0% |  −2.9% |
| v8-32               | month |              14.55 → 14.40 → 12.61 | 27.27 → 25.90 → 20.47 | 182 → 191 → 179 |     −1.0% | −13.3% |
| v8-32               | year  |              18.62 → 16.15 → 14.69 | 35.44 → 30.74 → 25.50 | 195 → 193 → 184 |    −13.3% | −21.1% |
| bun                 | timer |              11.06 → 14.30 → 12.26 | 23.48 → 32.26 → 25.47 | 178 → 223 → 194 |    +29.2% | +10.8% |
| bun                 | week  |                 7.55 → 9.73 → 9.17 | 15.39 → 20.19 → 19.13 | 162 → 196 → 168 |    +28.8% | +21.3% |
| bun                 | month |               9.84 → 11.83 → 10.78 | 19.91 → 27.53 → 22.99 | 171 → 212 → 183 |    +20.2% |  +9.5% |
| bun                 | year  |              11.68 → 13.88 → 13.10 | 22.79 → 30.59 → 26.43 | 173 → 218 → 189 |    +18.8% | +12.1% |

The JSONL also holds V8's render-thread and worker CPU. Shared lowers both on every page;
for example, the default-nursery timer's workers fall from 4.44 to 3.31 ms.

### Against task 081.19

The prototype bundle's changes against plain have the same sign as on WSL on every page
and engine. On WSL they were:

- V8 default nursery: +23.2% timer, −2.2% week, −6.7% month, −10.0% year.
- V8 32 MiB: +36.3% timer, −5.2% week, −8.1% month, −12.3% year.
- Bun: +19.5% to +36.0% on every page.

The timer regression is smaller here: +4.9% and +11.0%. Task 081.19's anomalous second
timer round inflated its means.

Shared beats both of 081.19's bundles on every V8 page. On Bun it costs about half of what
the prototype bundle does.

### Causes of the slower results

- The prototype timer on V8: task 081.19 added an adapter to every spread, `Object.keys`,
  and rest destructuring, and 081.20's V8 timer profile has the merge and split helpers
  among its top self time. Shared needs neither the adapters nor that helper structure,
  and isn't slower on any V8 page, so the regression doesn't carry over.
- Bun's cost with the shared bundle, from timer profiles of both bundles (6,024 samples
  against 5,266):
  - The per-key descriptor cache lookups in merge and split (`renderSharedCache`,
    `renderSharedMergeDescriptor`) are 4.0% of samples.
  - The re-homed split getter is 1.2%.
  - Every site getter is a `defineProperty` call. On JSC that costs more than a getter
    literal (78 against 47 ms in the gate), and JSC has no promotion problem for the call
    to remove.

## Getter creation and collection

Getter counts come from a separately instrumented Bun render, the 60th after warm-up.
"Fresh" counts getter functions that `defineProperty` hadn't seen before.

| Page  | defineProperty getters | Fresh defineProperty getters | defineProperties getters | Getter literals evaluated | Literal getters created |
| ----- | ---------------------: | ---------------------------: | -----------------------: | ------------------------: | ----------------------: |
| timer |     5,880 → 10 → 7,663 |              3,552 → 10 → 10 |                0 → 3 → 0 |           938 → 114 → 114 |       1,956 → 173 → 173 |
| week  |     3,989 → 10 → 5,663 |              2,323 → 10 → 10 |                0 → 3 → 0 |             859 → 44 → 44 |         1,719 → 45 → 45 |
| month |     4,104 → 10 → 8,886 |              2,438 → 10 → 10 |                0 → 3 → 0 |           2,252 → 44 → 44 |         4,827 → 45 → 45 |
| year  |    4,154 → 10 → 12,492 |              2,488 → 10 → 10 |                0 → 3 → 0 |           3,827 → 44 → 44 |         8,383 → 45 → 45 |

The shared bundle makes more `defineProperty` calls than plain, but almost none of them
create a getter. The remaining literals are sites with spreads or receiver references,
and code outside props.

The promotion probe and traces follow task 081.19's method:

- The probe uses 32 MiB semi-spaces, 20 measured renders after 50 warm-ups, and a full
  GC before each render.
- The traces cover 551 renders with `--trace-gc`.

| Page  | Promoted after first minor, MiB | After two minors, MiB | Heap increase after first minor, MiB | Retained after full, KiB |
| ----- | ------------------------------: | --------------------: | -----------------------------------: | -----------------------: |
| timer |              0.73 → 0.70 → 0.70 |    2.34 → 1.63 → 1.66 |                   2.87 → 2.05 → 2.52 |    23.52 → 24.36 → 21.54 |
| week  |              0.38 → 0.36 → 0.34 |    1.56 → 1.04 → 1.07 |                   1.95 → 1.37 → 1.60 |    11.92 → 10.45 → 11.74 |
| month |              0.78 → 0.71 → 0.56 |    2.55 → 1.51 → 1.57 |                   3.07 → 1.90 → 2.13 |    15.84 → 11.82 → 11.53 |
| year  |              0.92 → 0.93 → 0.98 |    3.53 → 2.03 → 2.07 |                   4.14 → 2.44 → 2.70 |    27.16 → 29.51 → 16.43 |

| Semi-space | Page  |         Scavenges |  Mark-compacts |
| ---------- | ----- | ----------------: | -------------: |
| default    | timer |   890 → 937 → 751 |  115 → 95 → 84 |
| default    | week  |   641 → 688 → 557 |   84 → 55 → 54 |
| default    | month |   885 → 827 → 708 |  115 → 83 → 75 |
| default    | year  | 1111 → 1004 → 921 | 142 → 109 → 97 |
| 32         | timer |   145 → 148 → 118 |   74 → 73 → 60 |
| 32         | week  |     107 → 97 → 88 |   55 → 38 → 44 |
| 32         | month |   143 → 127 → 110 |   74 → 63 → 55 |
| 32         | year  |   164 → 147 → 131 |   85 → 75 → 67 |

Shared promotes 29–41% less than plain after two minor GCs, as the prototype bundle does.
It needs the fewest scavenges on every page, and the fewest mark-compacts on all pages
but the 32 MiB week. [The samples and counts](shared-props-mac-diagnostics.jsonl) are
kept.

## Closing the engine gap

The table shows V8's best bundle (shared, 32 MiB) against Bun's plain bundle:

| Page  | V8 shared, 32 MiB | Bun plain | Ratio |
| ----- | ----------------: | --------: | ----: |
| timer |             13.99 |     11.06 |  1.26 |
| week  |             10.41 |      7.55 |  1.38 |
| month |             12.61 |      9.84 |  1.28 |
| year  |             14.69 |     11.68 |  1.26 |

For comparison, task 081.19's WSL numbers put the timer at 1.55: 17.26 ms against
11.14 ms.

The V8 timer profiles show where the time goes. The table gives self-time shares,
including idle samples:

| Bundle                |    GC | merge and split helpers | Descriptor cache | Sampled ms |
| --------------------- | ----: | ----------------------: | ---------------: | ---------: |
| Plain                 | 17.6% |                   19.1% |                — |      9,047 |
| Shared, first version |  9.3% |                   16.4% |             1.6% |      8,349 |
| Shared, as measured   |  9.9% |                   14.5% |             2.2% |      7,845 |

Changes tried, each with two alternating quick rounds of the timer and year pages:

| Change                                                                                             | V8 effect                                                                                                | Bun effect                                            | Kept                                                              |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| Keep `splitProps`' descriptor map in fast mode (no `delete`); list only names in `mergeProps`      | −4% timer, −2% year                                                                                      | Shared's cost over plain fell from about +20% to +17% | Yes                                                               |
| Copy plain data props by assignment in `splitProps`                                                | −3% timer, −3% year                                                                                      | +17% to +11%                                          | Yes                                                               |
| Hoist getter bodies into the shared descriptors, so slots hold captured values instead of closures | −2% in the gate (310 against 316 ms)                                                                     | −8% in the gate                                       | No: the closures are cheap, the `defineProperty` call is the cost |
| Copy prebuilt boilerplates with a host op around `v8::Object::Clone`                               | 5 times faster in the gate (32 against 167 ms); in pages +7% timer, +2% year, and 12–32 MB more peak RSS | Not applicable                                        | No ([patch](shared-props-mac-clone.patch))                        |

The remaining gap is GC at about 10% of V8's samples, the merge and split helpers at
about 15%, and their per-key descriptor lookups. Task 081.21 takes the next pass at these
and at an early-read props experiment.

## Validation

- **HTML:** all 108 timing runs gave byte-identical HTML against the same engine's
  plain bundle.
- **Hydration:** the hydration harness passed on the saved Start HTML and the shared
  bundle's V8 HTML for all four pages, with no errors, no replaced nodes, and successful
  in-document navigation:

  | Page  | Hydration nodes |
  | ----- | --------------: |
  | timer |             610 |
  | week  |             434 |
  | month |             901 |
  | year  |           1,376 |

- **Bundle tests:** all 10 pass, 5 for the shared props and 5 for the Solid adapter.
- **Render Cargo tests:** 8 tests pass with each bundle, and 2 are ignored.
- **Clippy** passes on all targets with `-D warnings`.
- **Lint:** oxlint now skips the bundle's injected runtime scripts and the benchmark
  scripts (`native/crates/render/bundle/*.js`, `bundle/bench/**`), where the app's rules
  only added suppressions.

## Reproduce

Commit `6ba17d2` has all three bundles. To reproduce the three-way comparison, run the
following from the repository root at that commit:

```sh
bun run build
bun native/crates/render/bundle/build.ts
bun native/crates/render/bundle/capture.ts
for v in plain prototype shared; do
  docker build -f native/crates/render/Dockerfile --build-arg RENDER_PROPS=$v -t snowtime-render:props-$v .
done
bash native/crates/render/bundle/props-measure.sh
python3 native/crates/render/bundle/props-summary.py
python3 native/crates/render/bundle/props-counts.py
```

The shape gate runs with `node --allow-natives-syntax --expose-gc`,
`deno run --v8-flags=--allow-natives-syntax,--expose-gc`, or `bun`, on
`native/crates/render/bundle/bench/accessor-shapes.js`.

For the GC probe:

1. Run `python3 native/crates/render/bundle/props-gc.py`, which prints a context
   directory.
2. Build that context with each `RENDER_PROPS` as `snowtime-render:props-gc-<variant>`.
3. Run each image with `RENDER_SEMI_MB=32 V8_FLAGS=--expose-gc RENDER_GC_PROBE=1
RENDER_CPU_PROFILE=/results/probe-unused.json` and 20 renders, saving the output to
   `results/props/diagnostic/<page>-<variant>-gc.txt`.

For traces, run the normal images with `V8_FLAGS=--trace-gc` and save the output as
`<page>-<default|32>-<variant>-trace.txt`. `props-diagnostics.py` then summarizes both.
