# Render hot spots on the Mac

Date: 2026-10-07. Task 081.21, branch `081-native-poc`, from `8291e77` to `bd15d4a`. Measured
on the Apple M1 Pro in Docker Desktop's Linux VM, one CPU and 2 GiB per container, as in
[task 081.20's report](shared-props-mac.md). The app was rebuilt and recaptured for the
full measurement, and task 081.20's bundles were rebuilt from `8291e77` on the same app
build, so both sides ran in one session.

## Result

Six small changes take 7–17% off V8's render CPU on every page, against task 081.20's
shared bundle. V8's best bundle (shared, 32 MiB semi-space) is now 1.12–1.27 times Bun's
plain bundle, down from 1.26–1.36:

| Page  | V8 shared, 32 MiB, before → now | Bun plain, before → now | Ratio, before → now |
| ----- | ------------------------------: | ----------------------: | ------------------: |
| timer |                   12.97 → 10.71 |            10.26 → 9.57 |         1.26 → 1.12 |
| week  |                     9.29 → 8.12 |             7.04 → 6.96 |         1.32 → 1.17 |
| month |                   11.69 → 10.78 |             8.75 → 8.48 |         1.34 → 1.27 |
| year  |                   14.27 → 13.22 |           10.46 → 10.39 |         1.36 → 1.27 |

The timer and week pages meet the 1.2 target; month and year don't. The defaults don't
change: V8 keeps the shared bundle, and Bun keeps plain, because shared still costs Bun 0–5%.

The early-read props experiment stopped at its first measurement. Getters that the build
can prove safe to read early make only 5–8% of merge and split keys copyable as data.

## Changes kept

Each change was checked with alternating quick rounds of the timer and year pages: V8 at a
32 MiB semi-space, and Bun on both bundles. Every run's HTML was byte-identical to the plain
bundle's. Two rounds proved too noisy on this machine, because a one-CPU container can
land on an efficiency core. A single run sometimes rose 20–30%, so changes after the first
were measured in four rounds. Effects are each change against the one before it, from the
means of its rounds:

| Commit    | Change                                                                                | V8 timer | V8 year | Bun shared timer, year | Bun plain timer, year |
| --------- | ------------------------------------------------------------------------------------- | -------: | ------: | ---------------------: | --------------------: |
| `4fea8b7` | Cache `uses12Hours` per locale (app code, `src/lib/date-input.ts`)                    |    −3.2% |   −1.4% |   +5.3%, +3.3% (noise) |          −0.2%, +1.4% |
| `9dc93c3` | List merge keys without a filtered copy in the shared `mergeProps`                    |    −4.3% |   +1.6% |           +0.6%, −0.9% |                     — |
| `51048fc` | Split merge results by copying their getters and sources, without descriptors         |    −9.7% |   −5.4% |          −10.2%, −8.4% |                     — |
| `146247a` | Render Lucide's string path elements with `ssrElement` instead of `Dynamic`           |    −2.7% |   −0.7% |           −4.0%, +3.6% |         −7.2%, −11.5% |
| `1975abb` | Look up cached merge and split descriptors without allocating on a hit                |    −3.2% |   −1.3% |           −7.2%, −3.6% |                     — |
| `bd15d4a` | Spread Lucide's default svg attributes as they are when no attribute names are mapped |    −7.7% |   −0.2% |           −1.7%, +0.5% |          −1.8%, +0.2% |

The merge listing's year result comes from one high round (17.60 ms against about 15.5);
the timer was lower in all four rounds. The Bun plain baseline of the first Lucide change
ranged from 10.08 to 16.97 ms, so its −11.5% is noise. The `uses12Hours` Bun shared costs
can't come from the change, which only removes work; base's own rounds differed by 5%. The
descriptor lookup's −7.2% on Bun's timer includes a slow first base round (12.75 ms against
about 9.7); its other rounds show about −1%.

- **`uses12Hours`** called `resolvedOptions()` on every time field render, and that builds
  a new object each time. The app now caches the answer per locale, and the same commit is
  meant for `main`.
- **The split fast path** covers most splits: on the timer, 400 of 459 split a merge result.
  A merge result's getters are non-configurable, so if its name count is unchanged since the
  merge, every name is one of its getters. Each part then gets the same sources and merge
  getters, without `Object.getOwnPropertyDescriptors` and without the re-homed getter that
  read through the merge result. A slot holding the result itself rejects spread copies and
  objects that inherit from it. A test checks key order, numeric keys, repeated keys,
  nested splits, and the fallbacks, and passes on the old runtime too.
- **Lucide** renders every path of an icon as `<Dynamic component={elementName} {...attrs} />`,
  which costs a `mergeProps` and a `splitProps` per path: 239 merges per timer render. The
  app uses Lucide as documented (per-icon imports, no provider), so the fix is a build-time
  patch, `bundle/lucide-nodes.ts`. It applies to both server bundles and renders a string
  element as `Dynamic` would: one `ssrElement` with a hydration key, inside the same
  `createComponent`. The same patch spreads the default attributes directly instead of
  rebuilding them with `Object.entries(...).reduce` for every icon. The build fails if
  Lucide's `Icon` changes.

## Full measurement

Three alternating rounds, 50 warm-ups and 500 measured renders each, round 2 reversed. CPU
in ms per render; "before" is task 081.20's bundle from `8291e77`. All 120 runs' HTML was
byte-identical to the same engine's plain bundle ([raw runs and bundle hashes](hot-spots-mac.jsonl)).

| Engine / semi-space | Page  | CPU, plain → before → shared |                p95 ms |     Peak RSS MB | Shared vs before |
| ------------------- | ----- | ---------------------------: | --------------------: | --------------: | ---------------: |
| v8-default          | timer |        14.92 → 14.04 → 12.04 | 33.53 → 24.11 → 22.75 | 143 → 125 → 126 |           −14.2% |
| v8-default          | week  |          10.83 → 9.71 → 8.82 | 20.03 → 12.34 → 12.24 | 133 → 123 → 124 |            −9.2% |
| v8-default          | month |        15.03 → 12.75 → 11.71 | 35.30 → 20.25 → 18.72 | 144 → 129 → 128 |            −8.1% |
| v8-default          | year  |        18.54 → 16.34 → 15.07 | 39.48 → 29.02 → 28.24 | 145 → 131 → 131 |            −7.8% |
| v8-32               | timer |        13.15 → 12.97 → 10.71 | 23.40 → 20.22 → 15.37 | 197 → 173 → 178 |           −17.4% |
| v8-32               | week  |           9.75 → 9.29 → 8.12 | 13.95 → 12.91 → 10.88 | 187 → 169 → 171 |           −12.6% |
| v8-32               | month |        13.02 → 11.69 → 10.78 | 22.95 → 17.46 → 15.34 | 193 → 178 → 176 |            −7.8% |
| v8-32               | year  |        16.66 → 14.27 → 13.22 | 30.47 → 23.35 → 22.06 | 194 → 184 → 185 |            −7.4% |

Bun ran four bundles: the current plain, task 081.20's plain, task 081.20's shared, and the
current shared.

| Page  | CPU, plain → before plain → before shared → shared |                        p95 ms |           Peak RSS MB |
| ----- | -------------------------------------------------: | ----------------------------: | --------------------: |
| timer |                        9.57 → 10.26 → 11.33 → 9.55 | 19.84 → 23.20 → 23.29 → 20.39 | 180 → 181 → 195 → 196 |
| week  |                          6.96 → 7.04 → 7.99 → 7.16 | 13.90 → 13.66 → 15.15 → 14.92 | 160 → 161 → 170 → 169 |
| month |                          8.48 → 8.75 → 9.92 → 8.85 | 17.07 → 17.22 → 19.84 → 18.42 | 166 → 171 → 183 → 179 |
| year  |                      10.39 → 10.46 → 11.91 → 10.90 | 19.81 → 20.17 → 23.08 → 22.10 | 175 → 176 → 191 → 187 |

The Lucide patches and the `uses12Hours` cache take 7% off Bun's plain timer, the page with
the most icons and time fields. Shared now matches plain on Bun's timer, but costs 3–5% on
the other pages and 9–16 MB more peak RSS on every page, so Bun keeps plain.

## Profiles

V8 at 32 MiB and Bun, timer page, shared bundle, self time including idle samples. The
"after" profiles were taken after the first Lucide change, before the last two changes:

| Function                             | V8 before | V8 after | Bun before | Bun after |
| ------------------------------------ | --------: | -------: | ---------: | --------: |
| GC                                   |     10.1% |    10.6% |          — |         — |
| Shared merge and split, and wrappers |     15.6% |     9.9% |      12.5% |     10.3% |
| Merge and split getters              |      2.9% |     2.1% |       3.7% |      2.9% |
| Descriptor cache                     |      2.1% |     0.6% |       4.3% |      2.7% |
| `buildLucideIconNode` and `Icon`     |      3.2% |     3.8% |       1.2% |      1.3% |
| `uses12Hours`                        |      1.2% |       0% |          — |         — |
| `injectAssets`                       |      1.3% |     2.4% |       5.9% |      6.5% |

Shares are of a smaller total after the changes: the "after" profiles hold 7% fewer V8
samples. Bun's rows count JavaScript frames only. Its builtins are separate frames, for
example `getOwnPropertyDescriptors` at 3.3% before.

`injectAssets`' self time is mostly its `indexOf("</head>")`, the first read of the page
string. That read flattens the string built from thousands of fragments, which encoding
would otherwise pay, so it isn't a saving to chase. On the year page the shared site
getter is the largest props cost (3.2% on V8), because one getter per key serves every site
and its slot read can't stay monomorphic.

Bun's timer spends 4.6% in `formatToParts`, called by `wallClock` in `src/lib/calendar.ts`
for every zone conversion. V8 spends 0.6% there, thanks to the render crate's cached Intl
parts (task 081.12).

### Month and year, task 081.23

2026-10-07, fresh profiles of `9adb20e`'s shared bundle, after Kait confirmed that the
other measurement session had stopped. V8 uses a 32 MiB semi-space; both engines use
one CPU and 2 GiB. Self-sample shares include idle samples, not whole-process CPU.
Bun's builtin frames are listed separately from JavaScript functions.

| Function or group                                     | V8 month | V8 year | Bun month | Bun year |
| ----------------------------------------------------- | -------: | ------: | --------: | -------: |
| Idle                                                  |    16.7% |   13.4% |         — |        — |
| GC                                                    |     9.6% |   11.0% |         — |        — |
| Shared site getter                                    |     2.4% |    3.5% |      0.5% |     0.4% |
| `renderSharedMergeKey`                                |     2.3% |    1.7% |      3.9% |     2.8% |
| `renderSharedSplit`                                   |     1.9% |    1.2% |      0.3% |     0.3% |
| `renderSharedMerge`                                   |     1.5% |    1.5% |      1.2% |     1.8% |
| Solid `createComponent`                               |     2.0% |    2.6% |      1.3% |     1.0% |
| Timesheet callbacks                                   |     1.9% |    1.9% |      1.3% |     1.7% |
| Cell's Show props constructor (`SharedProps$835`)     |     1.3% |    1.8% |      0.8% |     1.4% |
| Duration's Show props constructor (`SharedProps$605`) |     0.8% |    1.1% |      0.7% |     1.0% |
| `injectAssets`                                        |     1.2% |    2.2% |      7.4% |     8.8% |
| Solid `escape`                                        |     1.4% |    1.5% |      5.9% |     7.0% |
| Lucide builder, Icon, classes, and accessibility      |     0.8% |    0.8% |      0.4% |     0.3% |
| Seroval `advanceByteMatcher`                          |     0.6% |    2.1% |         — |        — |

The profiles contain 4,845 / 5,756 V8 samples and 3,736 / 5,165 Bun traces for month /
year. Anonymous timesheet callbacks were identified by their positions in the saved
bundle; generated constructors belong to the bundle runtime. These identify the report
code separately from Solid and its props helpers. Each individual named date-formatting
helper is below 0.6% on V8. The native SIMD UTF-8 encoder is 1.8% on V8 year; Bun's
separate encoder builtin is 6.6% / 6.0%. The named `parse` frames are schema/router
helpers, not native JSON-parser frames; the profiles do not establish a JSON-parsing
bottleneck or justify a simdjson render trial. Rust JSON handling is a separate
candidate in [task 081.12](../12-profiling.md).

Follow-up inclusive attribution on the same year profile puts Duration at about 4.5%
and router hydration-state serialization at about 5.4%. These shares include callees;
the table above lists self time. They motivate the additional candidates below.

Raw profiles stay ignored under `results/q21/profiles/t23-clean/`; their matching shared
bundle is `results/q21/bundles/t23-base.js`. Profiled run timings are not used to choose
changes.

## Early-read props

Behind its own option, the build pass marked getters whose body is a single `return` of
member reads, literals, and operators or template strings over them. Solid wraps only
dynamic expressions in getters, so literals alone never occur, and every marked getter is a
member read. 522 site getters qualified. An instrumented Bun render then classified every
merge and split key:

| Page  | Merge keys | Copyable | Of them, through an early getter | Split keys | Copyable | Of them, through an early getter |
| ----- | ---------: | -------: | -------------------------------: | ---------: | -------: | -------------------------------: |
| timer |      2,597 |    1,099 |                       135 (5.2%) |      1,662 |      590 |                       126 (7.6%) |
| week  |      2,010 |      667 |                       117 (5.8%) |      1,733 |      501 |                       112 (6.5%) |
| month |      2,079 |      690 |                       117 (5.6%) |      1,802 |      524 |                       112 (6.2%) |
| year  |      2,109 |      700 |                       117 (5.5%) |      1,832 |      534 |                       112 (6.1%) |

A key is copyable when every source that holds it has a data property or an early getter,
following merge and split getters to their sources. The experiment stopped here, without
the runtime part:

- Early getters make only 5–8% of keys copyable. The rest of the copyable keys are already
  plain data in their sources.
- Most other keys are blocked by a function source in a merge chain (Kobalte's), 507–540
  per render, or by lazy `children`, `class`, and ARIA getters.
- Copying the data-sourced keys eagerly needs a descriptor read per source key, which is the
  allocation the split fast path removed. It would also change what a later write to a
  source object does, a separate contract change.
- An early read also needs a guard against member reads that reach a rendering getter.
  That guard costs a check in every shared getter.

[The patch](hot-spots-mac-early.patch) keeps the classifier and the early bundle's build
option.

## Not changed

- Bun's `encode` and `injectAssets` (6.3% and 6.5% of Bun's timer samples). Both work on
  the finished page string, and the task left them optional.
- `wallClock`'s `formatToParts` on Bun: a follow-up for the app, because it only costs Bun.
  Task 081.22 replaced it.

## Task 081.22's follow-ups

2026-10-07, from `bd15d4a` to `5cb2245`, on the same machine. The app was rebuilt and
recaptured after the app fixes, and both sides ran in one session. V8's render CPU is
unchanged within noise except on month, but the minified bundle takes 7–9 MB off V8's
loaded RSS and 7–13 MB off its peak on every page. The CPU ratio to Bun's plain bundle
doesn't improve, because the app fixes also help Bun:

| Page  | V8 CPU, before → now | V8 loaded RSS MB | V8 peak RSS MB | Bun plain CPU | Ratio, before → now |
| ----- | -------------------: | ---------------: | -------------: | ------------: | ------------------: |
| timer |        11.52 → 11.27 |      69.1 → 61.9 |      177 → 170 |   9.49 → 9.34 |         1.21 → 1.21 |
| week  |          8.25 → 8.68 |      68.9 → 60.3 |      175 → 164 |   6.91 → 6.67 |         1.19 → 1.30 |
| month |        11.32 → 10.66 |      69.3 → 60.6 |      179 → 167 |   8.59 → 8.42 |         1.32 → 1.27 |
| year  |        13.51 → 13.45 |      68.8 → 61.5 |      187 → 174 | 10.58 → 10.43 |         1.28 → 1.29 |

V8 runs the shared bundle at a 32 MiB semi-space; "before" is task 081.21's final bundles.
Three alternating rounds, 500 renders each, round 2 reversed
([raw runs and bundle hashes](hot-spots-follow-ups.jsonl)). Week's rise comes from one
round (9.48 ms against 8.20 and 8.34); without it the ratio is 1.24. This session's
"before" ratios are 0.02–0.09 higher than task 081.21's, so compare within a table only.
Every run's HTML matched the same engine's plain bundle, and the hydration check passed on
all four pages.

- **App fixes** (`3f58a26`, on `main` as `9536fdb`). `formatIsoDateRange` caches its
  formatter, and `wallClock` parses `format()` instead of calling `formatToParts`. In
  quick rounds against `bd15d4a`: V8 month −5.5% and year −2.5%, the timer within noise;
  Bun shared −1 to −4%, Bun plain −1 to −3%.
- **Minification** (`5cb2245`). `bundle/build.ts` runs rolldown's `minifySync` on both
  bundles, with compression, names kept, and ASCII output. V8 stores a script's source at
  two bytes per character if any character is above U+00FF, and the bundle had about 100
  (dashes, quotes, emoji). The build warns about any that remain. One was in a `String.raw`
  regex, which the minifier leaves as written, so `src/lib/tickets.ts` now escapes it
  (`49226d2`, on `main` as `4783c27`). The renderer's binary fell from 98.3 MB to 94.9 MB.
  In quick rounds, minifying without ASCII output saved 3.7 MB of loaded RSS, and Bun's
  re-print (`bun build --no-bundle --minify-syntax`) 7 MB, because it escapes every
  non-ASCII character. Neither changed CPU on V8.
- **Lucide's icon building** stays. What remains of `buildLucideIconNode` is class merging,
  alias lists, and attribute spreads, which needs a rewrite of the function rather than a
  small addition to `bundle/lucide-nodes.ts`.

`render-bench` keeps 24.7 MB of symbol tables (`.symtab` and `.strtab`) for profiles; the
release image (`native/Dockerfile`) already strips the server.

## Task 081.23's month and year trials

First pass, 2026-10-07, `9adb20e`, M1 Pro and Docker Desktop. None of these three
candidates qualifies: the getter has no repeatable V8 win, the cell rewrite slows both
engines, and Lucide's year gain
comes with a month regression. All three are reverted, and no app commit goes to `main`.

Four alternating quick rounds, 500 renders per run, with one CPU and 2 GiB; V8 uses the
shared bundle and a 32 MiB semi-space, and Bun uses both bundles. Rounds 2 and 4 reverse
the order. All candidates compare with the baseline in this one session. The initial
run overlapped another session and was stopped; none of its numbers or profiles is used.
The timer runs for shared code; the cell trial runs on month and year.
[Raw runs and bundle hashes](month-year-trials-mac.jsonl) retain each round. Positive
changes mean more CPU per render:

| Trial  | Page  | V8 shared | Bun shared | Bun plain |
| ------ | ----- | --------: | ---------: | --------: |
| getter | timer |     +1.6% |      +1.7% |         — |
| getter | month |     +2.4% |      +1.4% |         — |
| getter | year  |     -0.5% |      +1.5% |         — |
| cell   | month |     +3.8% |      +8.2% |     +4.5% |
| cell   | year  |     +4.3% |      +7.6% |     +9.7% |
| lucide | timer |     -0.3% |      -2.2% |     -0.5% |
| lucide | month |     +1.9% |      +2.2% |     -1.2% |
| lucide | year  |     -1.3% |      +0.1% |     -0.5% |

- **Getter:** `shared-props.ts` generates one named getter per prop key with a direct
  read of that key's symbol, rather than routing all keys through `this[slot]` in one
  getter body. The descriptor remains shared per key. This does not qualify; a key's
  getter still serves props objects from many sites with different shapes.
- **Cell:** `timesheet.tsx` puts one `<td>` around Show, makes the dot its fallback, and
  folds the empty-cell class into `shade`. It reduces the Show props' getters, but its
  whole-render cost rises on both engines. The existing branch structure stays.
- **Lucide:** the trial replaces `buildLucideIconNode` in `lucide-nodes.ts` with loops for class
  deduplication and direct attribute assignments. Unscaled child nodes are reused;
  attribute-name remapping falls back to the upstream builder. Comparisons cover
  classes, aliases, sizes, absolute/non-scaling stroke, accessibility, and attributes.
  The trial guards the complete compiled Icon module with SHA-256. Its tests pass and
  reject changes both to a node and to an unrelated Icon expression. A build with the
  changed expression also fails with `Unsupported lucide-solid Icon implementation`.
  Month's V8 regression disqualifies the replacement. The existing Lucide patch stays.

The getter's plain bundle is byte-identical to the baseline's, so Bun plain runs once
for both. Every candidate's HTML matches its own same-engine plain build: exact on V8,
whitespace-normalized on Bun. No code is kept, so there is no new hydration check or
full three-round before/after measurement. `checks.sh` passes before the report commit:
13 bundle tests, 8 render tests (2 ignored), and Clippy. An unfiltered app test run
confirms 464 Bun tests and 184 Vitest tests passing.

## Task 081.23's additional candidates

2026-10-07, `85206c9`, M1 Pro and Docker Desktop. None of the four additional candidates
qualifies. Duration wins in the four short
alternating rounds, but month costs V8 and Bun shared in the longer confirmation. The
clone skip, class joins, and finished Lucide cache fail the quick rounds. All four are
reverted; no app commit goes to `main`.

Kait confirmed that task 081.17 was idle and cleared this session. An early screen used
two alternating rounds of 100 renders on V8 shared only. All four candidates then ran
four alternating rounds of 100 renders on timer, month, and year: V8 shared at a 32 MiB
semi-space and Bun on both bundles. Containers have one CPU and 2 GiB. Rounds 2 and 4
reverse the candidate order. Compare only within this table; positive changes cost CPU.
[Raw runs and bundle hashes](month-year-more-trials-mac.jsonl) include the early screen,
the four quick rounds, and the final confirmation as separate sessions.

| Trial    | Page  | V8 shared | Bun shared | Bun plain |
| -------- | ----- | --------: | ---------: | --------: |
| duration | timer |     -1.5% |      -1.5% |     -5.8% |
| duration | month |     -3.0% |      -4.0% |     -3.7% |
| duration | year  |     -4.8% |      -3.6% |     -2.6% |
| stored   | timer |     -1.2% |      -3.8% |     -7.9% |
| stored   | month |     -2.1% |      -3.2% |     -3.6% |
| stored   | year  |     +1.5% |      +0.6% |     -0.7% |
| classes  | timer |     -4.1% |      -1.2% |     -5.9% |
| classes  | month |     -3.0% |      -2.1% |     -4.3% |
| classes  | year  |     +0.9% |      -1.7% |     +1.1% |
| cache    | timer |     -4.0% |      +1.3% |     -7.5% |
| cache    | month |     -0.6% |      +3.3% |     +1.4% |
| cache    | year  |     +2.4% |      +0.5% |     -0.1% |

- **Duration:** a reactive conditional replaces Show, and an array map replaces For in
  `src/components/duration.tsx`. The unit spans keep their text and classes. The recorded
  pages use clock format, so the quick-round gain reflects removing Show and its props.
  The unit parts' regex split remains. A component test
  switches clock to units and back, changes the amount, and checks the exact spans.
- **Store clone:** `stored()` skips `structuredClone` on the server. Timer and month
  improve, but year does not win on V8. The existing clone remains.
- **Cell classes:** both callers were inspected before replacing `cn()` with joins. The
  regular row passes no class, and the total row passes only `font-medium`, which
  conflicts with neither background nor text shade. Year does not win on V8 and Bun
  plain costs 1.1%, so the existing `cn()` calls remain.
- **Lucide cache:** a WeakMap on each icon's node holds the completed SVG array by scalar
  parameter signature, with at most 64 entries per node. Explicit
  `attributes` or `attributeNames` use the original builder. The compiled Icon avoids
  an empty rest-attributes object so ordinary calls reach the cache. The trial guards
  the full Icon module with SHA-256 and preserves its line count. Equivalence tests
  cover classes, aliases, sizes, stroke modes, accessibility, and attribute overrides.
  Tests recursively freeze a cached result and render the actual compiled Icon twice
  without mutation: 6 tests and 67 assertions pass. A build with a changed Icon fails
  with `Unsupported lucide-solid Icon implementation`. Year regresses on V8 and month
  costs Bun on both bundles, so the trial is reverted.

Each candidate's shared HTML matches its same-engine plain bundle: exact on V8,
whitespace-normalized on Bun. Production assets were then rebuilt for Duration, API
answers and Start HTML recaptured, and baseline and Duration render bundles built
against the same new client manifest. Three alternating rounds of 500 renders cover
all four pages, with round 2 reversed. These numbers belong to this final session:

| Page  | V8 CPU, before → Duration | V8 loaded RSS MB | V8 peak RSS MB | Bun plain CPU, before → Duration | Ratio, before → Duration |
| ----- | ------------------------: | ---------------: | -------------: | -------------------------------: | -----------------------: |
| timer |             13.44 → 13.19 |      59.5 → 59.9 |      168 → 168 |                    11.13 → 10.81 |              1.21 → 1.22 |
| week  |               9.27 → 9.49 |      59.6 → 59.4 |      162 → 162 |                      8.11 → 7.71 |              1.14 → 1.23 |
| month |             12.27 → 12.65 |      60.1 → 60.0 |      165 → 163 |                    10.22 → 10.11 |              1.20 → 1.25 |
| year  |             15.62 → 15.09 |      60.8 → 60.9 |      175 → 171 |                    12.45 → 12.18 |              1.25 → 1.24 |

The longer session confirms Duration's year gain (V8 −3.4%, Bun shared −2.7%, and Bun
plain −2.1%), but month costs V8 3.1% and Bun shared 5.1%. Week costs V8 2.3%. There are
large swings in individual runs; they remain in the averages and raw record. The result
does not establish a repeatable month win without Bun cost, so Duration is reverted.
The quick and final sessions are reported separately; their numbers are never pooled.

All final HTML matches each variant's same-engine plain bundle. Units-format renders
also match on V8 and Bun on all four pages. The candidate component regression test
passes. No code is kept, so a new hydration check is not required. `checks.sh` passes
before the report commit: 13 bundle tests, 8 render tests (2 ignored), and Clippy.
An unfiltered app run confirms 460 Bun tests and 184 Vitest tests on the restored source;
saved rejected-trial test fixtures are excluded from discovery.

Router hydration-state serialization (`dehydrate` / `crossSerializeStream`, about 5.4%
inclusive on year) and GC (9.6% month / 11.0% year self samples) are the largest remaining
costs identified for follow-up. Both are outside this task. Inclusive time overlaps its
callees, so these shares should not be added.

## Follow-ups

- **Month and year:** task 081.23 records both passes of rejected trials above.
- **Release image base.** A distroless base in place of `debian:trixie-slim` would make
  the image about 80 MB smaller and change nothing at runtime. The health check would
  need to stop using `curl`. Not worth a task on its own.

## Validation

- **Hydration:** the hydration harness passed on Start's HTML and the shared bundle's V8
  HTML for all four pages: 610, 434, 901, and 1,376 nodes, no errors, no replaced nodes,
  and in-document navigation.
- **Bundle tests:** 13 pass, including the new split and Lucide tests.
- **Render Cargo tests:** 8 pass and 2 are ignored. Clippy passes on all targets with
  `-D warnings`.
- **App tests:** `bun run test` passes, and the lefthook lint, format, and Knip checks ran
  on every commit.

## Reproduce

From the repository root at `bd15d4a`, rebuild and recapture as in the render README, then
build task 081.20's bundles by checking out `8291e77`'s `native/crates/render/bundle` and
`src/lib/date-input.ts`, running `bun native/crates/render/bundle/build.ts`, and saving
`dist/render.js` and `dist/render.shared.js` before restoring both paths. Build
`snowtime-render:props-plain`, `props-shared`, and `props-before` (task 081.20's shared
bundle copied to `dist/render.shared.js`) with the Dockerfile, then run the three alternating
rounds as `props-measure.sh` does, with Bun on all four saved bundles through
`BUN_RENDER_BUNDLE`.
