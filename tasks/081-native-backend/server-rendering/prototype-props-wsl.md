# Prototype getter props on WSL

Date: 2026-10-07. Task 081.19, branch `081-prototype-props`, based on `3392ee2`.
The app and browser build are unchanged from task 081.14. The plain bundle is byte-for-byte
that task's selected `render.fix.js`, SHA-256 `abc570c8837c15de223932d0f910b22270e98c11c2e90e0f6d2e5c66ec98b350`.
The saved captures were reused.

## Decision

Keep the **plain bundle as the default on both engines**. The prototype variant helps
V8's report pages, but slows the timer. Bun uses 20–36% more CPU on every page and has
higher peak RSS. `RENDER_PROTOTYPE_PROPS=1` remains an explicit experiment.

V8's second timer round is anomalous: the plain/default run takes 24.79 ms rather than
18.68 and 17.94 ms, and the two prototype runs take 37.36 and 34.11 ms. Their cause was not
isolated. They remain in the raw data and means below. Rounds 1 and 3 still put the
prototype timer 4–5% slower at the default nursery and 5–7% slower at 32 MiB, so excluding
the anomalous round would not reverse the default decision.

## Implementation and compatibility

The post-bundle Acorn pass rewrites **1,331 sites, with zero skipped sites** in this app.
It handles getter literals at `createComponent`, `mergeProps`, and `ssrElement`, including
computed literal keys. Each site has one constructor and enumerable prototype getters.
Getter thunks go into individual private instance fields. Data properties remain own
fields. Getter bodies keep their live closures and evaluate only on a read.

Literals with spreads, setters, methods, duplicate or unsupported keys, or receiver
references (`this`, `arguments`, `super`, `new.target`) fall back to the original literal.
Tests cover these fallbacks, nested rewrites, laziness, cached-layout isolation between
renders, data snapshots, descriptor flags, symbols, and rest evaluation order.
The existing Solid adapter now guards both upstream helper implementations by hash.

`mergeProps` and `splitProps` use shared prototype layouts, with a cache bounded at 512
shapes. Cache entries contain keys, flags, and getter code, not render sources. Each
instance reads its own source. Merge still searches sources from right to left, calls
function sources lazily on reads, and falls back when a value is `undefined`. Split
copies data descriptors and re-homes lazy reads to their source.

The upstream investigation eventually chose **shared own accessor descriptors** rather
than bare prototype getters. That preserves the general props contract
([solid#3511](https://github.com/solidjs/solid/issues/3511),
[solid#3550](https://github.com/solidjs/solid/pull/3550)). This task deliberately tests the
earlier prototype form. The getter re-homing constraint is also described in
[next-yak#659](https://github.com/DigitecGalaxus/next-yak/pull/659).

### Reads of props

[The complete inventory](prototype-props-audit.jsonl) lists all **743** original
reflection, object-spread, rest, and `for…in` operations, a superset of props reads. Each
row gives the bundled line, original source and line, expression, and handling.
`prototype-audit.py` maps the build's inventory through the plain bundle's source map.

| Consumer                                                          | Handling                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Solid server merge/split descriptor reads                         | Replace the helper bodies with cached prototype adapters.                                                           |
| Solid web `ssrElement` keys and `createDynamic` spread            | Brand-aware key enumeration and value copying.                                                                      |
| Kobalte split/merge and object spreads                            | Use the shared adapters and guarded spreads. Its `for…in` presence checks already see enumerable prototype getters. |
| TanStack Solid router prop forwarding and head-content operations | Guard spreads and reflection. Router provider parameter rest uses the descriptor bridge.                            |
| TanStack Solid form `createField` and `createFormGroup` rest      | Use the descriptor bridge.                                                                                          |
| TanStack Solid query and form option/data spreads                 | Guard every bundled operation; ordinary data retains the native path.                                               |
| `@solidjs/meta` tag keys and entries                              | Brand-aware enumeration. `Object.hasOwn` receives the plain `Object.fromEntries` result.                            |
| App prop-derived spreads and class-variance-authority entries     | Guard the bundled operation.                                                                                        |
| Babel's descriptor-copy spread helper                             | Re-home prototype descriptors so a copied getter reads the source, retaining its receiver.                          |

Native rest destructuring needs a narrow **own-descriptor bridge**. Eagerly spreading
first would change the read order of `{b, a, ...rest}` to source order. The bridge leaves
those getters lazy for native destructuring and preserves named-getter order. It creates
some per-render own accessors; the counts below include them. Raw own-property checks
still distinguish inherited getters from own fields. This experiment supports the
audited bundle, not arbitrary unadapted props consumers.

Both bundles are emitted beside each other. V8 selects one when Cargo creates its
startup snapshot; setting the environment on an already built binary cannot replace its
snapshot. Bun selects one at startup. The browser build and render pool source
`native/crates/render/src/lib.rs` are unchanged.

## Timing and memory

One CPU and 2 GiB per Docker container, one renderer and client, 50 warm-ups and 500
measured renders. Three rounds per page, with order reversed in round 2. Every run checks
byte-identical HTML against its same-engine plain control. The engines serialize a
function with different whitespace even in the plain bundle, so cross-engine HTML is
not the equality test.

Values are arithmetic means of the three runs, including each run's p95 and peak RSS.
CPU is whole-process `getrusage`; render-thread and V8-worker CPU come from
`render-bench`'s `thread_cpu_ms`. Worker time includes GC and compilation.
[All 72 runs and bundle hashes](prototype-props-wsl.jsonl) are retained.

| Engine / semi-space | Page  | CPU ms, plain → prototype | Render thread |  V8 workers |        p95 ms | Peak RSS MB | CPU change |
| ------------------- | ----- | ------------------------: | ------------: | ----------: | ------------: | ----------: | ---------: |
| v8-default          | timer |             20.47 → 25.22 | 15.88 → 19.53 | 4.54 → 5.63 | 40.26 → 44.61 |   146 → 145 |     +23.2% |
| v8-default          | week  |             11.97 → 11.71 |   9.21 → 9.04 | 2.70 → 2.61 | 23.35 → 20.88 |   134 → 145 |      -2.2% |
| v8-default          | month |             15.57 → 14.52 | 11.79 → 10.95 | 3.73 → 3.52 | 33.08 → 27.67 |   140 → 145 |      -6.7% |
| v8-default          | year  |             19.42 → 17.48 | 14.63 → 12.87 | 4.74 → 4.55 | 38.72 → 33.95 |   146 → 150 |     -10.0% |
| v8-32               | timer |             17.26 → 23.53 | 13.57 → 18.75 | 3.63 → 4.69 | 32.78 → 44.68 |   188 → 197 |     +36.3% |
| v8-32               | week  |             11.50 → 10.90 |   9.13 → 8.73 | 2.31 → 2.11 | 19.36 → 19.62 |   185 → 194 |      -5.2% |
| v8-32               | month |             14.63 → 13.44 | 11.35 → 10.55 | 3.23 → 2.82 | 27.72 → 24.51 |   185 → 194 |      -8.1% |
| v8-32               | year  |             17.69 → 15.52 | 13.62 → 12.03 | 3.99 → 3.43 | 32.28 → 30.01 |   198 → 197 |     -12.3% |
| bun                 | timer |             11.14 → 15.15 |             — |           — | 22.55 → 31.92 |   175 → 219 |     +36.0% |
| bun                 | week  |               7.22 → 9.39 |             — |           — | 14.81 → 20.30 |   156 → 195 |     +29.9% |
| bun                 | month |              8.87 → 11.40 |             — |           — | 17.81 → 26.17 |   164 → 211 |     +28.4% |
| bun                 | year  |             10.93 → 13.07 |             — |           — | 21.25 → 29.21 |   177 → 224 |     +19.5% |

## Getter creation and collection

Getter counts are from a separately instrumented Bun render after warm-up. They count
construction, not reads, and do not instrument the timing runs. The residual own
accessors include the native-rest bridge and unsupported getter literals.

| Page  | defineProperty getters | defineProperties getters | Getter literals evaluated | Literal getters created |
| ----- | ---------------------: | -----------------------: | ------------------------: | ----------------------: |
| timer |             5,880 → 10 |                    0 → 3 |                 938 → 114 |             1,956 → 173 |
| week  |             3,989 → 10 |                    0 → 3 |                  859 → 44 |              1,719 → 45 |
| month |             4,104 → 10 |                    0 → 3 |                2,252 → 44 |              4,827 → 45 |
| year  |             4,154 → 10 |                    0 → 3 |                3,827 → 44 |              8,383 → 45 |

The promotion probe uses 32 MiB semi-spaces and 20 measured renders after 50 warm-ups.
Each render starts after a full GC. It then measures old-space usage immediately before
and after one minor GC, after a second minor GC, and after a final full GC. The promoted
columns subtract the old-space usage immediately before the first minor; they exclude
direct old-space allocations made during rendering. Heap increase and retained heap
subtract the full-GC baseline before rendering.

A diagnostic-only extension invokes V8's testing GC API through the existing inspector
profiling hooks. The preparation script copies build inputs to a unique temporary
directory and changes its extensions and profiler; the render pool source remains
byte-identical, even in that copy. These forced collections change GC scheduling, so
their CPU is excluded from the timing comparison.

| Page  | Promoted after first minor, MiB | Promoted after two minors, MiB | Heap increase after first minor, MiB | Retained after full, KiB |
| ----- | ------------------------------: | -----------------------------: | -----------------------------------: | -----------------------: |
| timer |                     0.63 → 0.70 |                    2.24 → 1.63 |                          2.77 → 2.06 |            22.54 → 24.23 |
| week  |                     0.38 → 0.36 |                    1.56 → 1.04 |                          1.95 → 1.39 |            11.84 → 16.06 |
| month |                     0.78 → 0.71 |                    2.55 → 1.51 |                          3.07 → 1.90 |            15.54 → 11.75 |
| year  |                     0.97 → 0.94 |                    3.57 → 2.03 |                          4.18 → 2.46 |            27.75 → 31.72 |

Promotion after the first minor barely changes. After two minors it falls by 27–43%,
and the heap remaining after the first minor falls too. The small full-GC residual does
not show a consistent improvement. This layout reduces retention but does not eliminate
the post-render promotion problem.

The following separate `--trace-gc` runs each include 551 renders: one initial render,
50 warm-ups, and 500 measured renders. They use the normal images, without the forced-GC
probe. Counts include initialization and warm-up collections.

| Semi-space | Page  |   Scavenges | Mark-compacts |
| ---------- | ----- | ----------: | ------------: |
| default    | timer |   889 → 935 |      115 → 95 |
| default    | week  |   643 → 687 |       84 → 54 |
| default    | month |   884 → 849 |      115 → 80 |
| default    | year  | 1108 → 1000 |     142 → 106 |
| 32         | timer |   145 → 145 |       74 → 72 |
| 32         | week  |    107 → 97 |       55 → 37 |
| 32         | month |   143 → 123 |       74 → 60 |
| 32         | year  |   163 → 145 |       85 → 73 |

[Diagnostic samples and counts](prototype-props-diagnostics.jsonl) retain the measured
probe samples, getter totals, and trace totals. Large traces and generated diagnostic
images remain under ignored results directories.

## Validation and reproduction

All 72 timing runs produced byte-identical HTML against their same-engine plain
control. The production-browser hydration harness passed on both the saved Start HTML
and rewritten V8 HTML for all four pages. It reported no console/page errors, no
replaced hydration nodes, and successful navigation within the same document.

| Page  | Hydration nodes | Replaced nodes | Navigation |
| ----- | --------------: | -------------: | ---------- |
| timer |             610 |              0 | passed     |
| week  |             434 |              0 | passed     |
| month |             901 |              0 | passed     |
| year  |           1,376 |              0 | passed     |

Timer and year screenshots were also inspected. The app and production client were not
rebuilt or changed.

Validation passed:

- All 460 Bun server/harness tests, including 13 Solid adapter and rewrite tests.
- Render Cargo tests with both bundle flags: five tests each, plus two ignored doc tests.
- Render Clippy on all targets with `-D warnings`.
- Harness oxlint, formatting, both project and benchmark Knip checks, and `git diff --check`.

The component suite passed 183 of 184 tests on the real clock. The unchanged timer test
`Add entry picks recent work and starts after today’s last entry` assumes that today's
09:15 entry has already ended. The run occurred before 09:15 in Tallinn, so
`lastEnded` correctly excluded it as a future entry. All 35 timer component tests passed
with a controlled afternoon Date. No app code or tests were changed to address this
existing clock dependency.

### Reproduce

Use the existing task 081.14 captures and matching production client under `results/`
and `.output/`. If app sources change, recapture before comparing. Install the root and
isolated benchmark dependencies as described in the render README, then run:

```sh
bun native/crates/render/bundle/build.ts
docker build -f native/crates/render/Dockerfile --build-arg RENDER_PROTOTYPE_PROPS=0 -t snowtime-render:prototype19-plain .
docker build -f native/crates/render/Dockerfile --build-arg RENDER_PROTOTYPE_PROPS=1 -t snowtime-render:prototype19 .
mkdir -p native/crates/render/results/prototype
cp native/crates/render/bundle/dist/render.js native/crates/render/results/prototype/render.measured.plain.js
cp native/crates/render/bundle/dist/render.prototype.js native/crates/render/results/prototype/render.measured.prototype.js
bash native/crates/render/bundle/prototype-measure.sh
python3 native/crates/render/bundle/prototype-summary.py
python3 native/crates/render/bundle/prototype-audit.py
python3 native/crates/render/bundle/prototype-counts.py
```

For hydration, copy each `results/prototype/html/<page>-v8-32-prototype.html` to
`results/<page>-v8.html`, retain the saved `<page>-start.html` files, and run
`bun native/crates/render/bundle/hydrate-check.ts`.

For the forced-GC diagnostic, `python3 native/crates/render/bundle/prototype-gc.py`
prints a unique context directory. Build that context twice with the render Dockerfile,
using `RENDER_PROTOTYPE_PROPS=0` and `1`, tagged `snowtime-render:prototype19-gc-plain`
and `snowtime-render:prototype19-gc-prototype`. For each page and variant, run:

```sh
results="$(pwd)/native/crates/render/results"
page=timer
variant=plain
docker run --rm --cpus=1 --memory=2g   -e RENDER_SEMI_MB=32 -e V8_FLAGS=--expose-gc   -e RENDER_GC_PROBE=1 -e RENDER_CPU_PROFILE=/results/probe-unused.json   -v "$results:/results" "snowtime-render:prototype19-gc-$variant"   "/results/$page.json" /results/answers.json 20 1 1   > "$results/prototype/diagnostic/$page-$variant-gc.txt" 2>&1
```

For traces, use the normal images with `V8_FLAGS=--trace-gc`, 500 renders, and either
no nursery override or `RENDER_SEMI_MB=32`. Save combined output as
`results/prototype/diagnostic/<page>-<default|32>-<plain|prototype>-trace.txt`.
Then run `python3 native/crates/render/bundle/prototype-diagnostics.py` to regenerate
the committed diagnostic summary data.
