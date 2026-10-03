# SSR in a Rust server: embedded JS engines compared

> The spike's write-up from 2026-10-02, kept as it was. Its recommendation against an
> embedded engine is superseded: Kait chose server rendering with V8 the same day, after
> the heap and GC measurements in [01-server-rendering.md](../01-server-rendering.md).
> The paths below (`bundle/`, `engines/`, `capture/`, and the scripts) are in the
> gitignored `temp/ssr-spike/` of the `snowtime-ssr-spike` worktree, not in the repository.

A spike for task 081. The question: can the Rust server render the app's existing Solid
pages to hydratable HTML by embedding a JS engine, and at what cost in memory, speed, and
output equality? Measured on 2026-10-02 on an Apple M-series Mac (10 cores, macOS 26),
worktree `snowtime-ssr-spike` at main `2c2d585`.

## Short answer

- **It works.** One standalone render bundle (no Node APIs, no Start runtime) renders the
  real route tree to the same hydratable HTML that Start renders. In Chrome, Start's own
  client hydrates it exactly as it hydrates Start's HTML. V8, JavaScriptCore,
  SpiderMonkey, and QuickJS all run it. Boa and Perry don't.
- **Speed is fine with a JIT.** A render takes 4 to 17 ms on Bun, V8, JSC, or
  SpiderMonkey. That's well under today's 18–52 ms of server CPU per page load in
  `perf:load`, which includes the reads.
- **Memory is the problem.** Every JIT engine settles at 200–400 MB of RSS under
  back-to-back renders with default GC settings. Capping V8's heap brings it to about
  110–150 MB and doubles the render time. Even the leanest setup that works, V8 from a
  snapshot, starts at 28 MB before its first render. Task 081's target is under 64 MB for
  the whole server.
- **Recommendation:** don't embed a JS engine in the native server. Keep task 079's
  shells, and do subtask 04: the Rust server inlines the first load's API JSON into the
  shell, so no JS runs on the server. If server-rendered HTML is ever needed, run this
  bundle in a separate Bun render process (a sidecar), not inside the Rust binary.

## Method

### The render bundle

`bundle/` builds one IIFE, `dist/render.js` (2.6 MB unminified), with plain Vite 8,
vite-plugin-solid (`generate: 'ssr', hydratable: true`), and TanStack's router plugin.
Start's plugin isn't used.

- **Stubs:** `@tanstack/solid-start` is replaced by a stub (`bundle/stubs/solid-start.ts`).
  Its `createServerFn` returns a chainable function that throws if called; a render never
  calls one. Every `*.server.ts` file, `~/db`, `~/env`, Paraglide's server module, and the
  server-only packages the app's own code imports (Better Auth server, Drizzle, libSQL,
  Upstash, `node:*`) resolve to a Proxy whose functions throw when called. Rolldown has no
  `syntheticNamedExports`, so a transform rewrites their named imports into property
  reads. Client libraries in `node_modules`, such as `better-auth/client`, keep their real
  dependencies, as in Start's SSR build.
- **Code splitting:** the router plugin splits route components the way Start does
  (`autoCodeSplitting`). Without it the hydration keys differ, because each
  `lazyRouteComponent` adds a component level. The plugin needs the route generator, so it
  writes its tree to `dist/routeTree.scratch.ts`, and the app's `routeTree.gen.ts` stays
  untouched.
- **Render path:** this mirrors Start's request handler (`bundle/render.ts`).
  1. `getRouter()`, then TanStack Query `hydrate()` of the fixture into the router's
     QueryClient.
  2. `router.update` with a memory history, `attachRouterServerSsrUtils` with Start's
     client manifest (`fixtures/manifest.json`, taken from the build), `router.load()`,
     and `serverSsr.dehydrate()`.
  3. Solid's `renderToStringAsync` of `<>{doctype}<StartServer/></>`, the same tree as
     Start's stream handler, then `transformHtmlStringWithRouter`.

  Every loader and the session `beforeLoad` read the seeded cache, so no server function
  runs.

- **Prelude** (`bundle/prelude.ts`, the same code on every engine):
  - Always installed: a fixed `Date` (the fixture's `now`, SEED_NOW), and virtual timers
    that the host advances with `__ssrTick()` once the microtasks have drained.
  - Installed only where missing: core-js `URL`/`URLSearchParams`,
    web-streams-polyfill, `TextEncoder`/`TextDecoder` with `encodeInto`,
    `AbortController`, `queueMicrotask`, `structuredClone`, a console, and
    `fetch`/`Request`/`Response`/`Headers` stubs that throw (better-auth's client checks
    `"credentials" in Request.prototype` when it loads).
- **Host API:** call `SnowtimeSSR.start(url, fixtureJson)`, drain the microtasks, check
  `status()`, call `__ssrTick()` if it's still running, and finish with `take()`. A
  successful render fires no timers.
- **Variants:** `dist/render.intl.js` adds FormatJS Intl polyfills for engines without
  Intl, and `dist/render.mjs` is an ES module build for Perry.

### Fixtures and the reference

`capture/capture.ts` builds main through `perf/lib` and serves it on the benchmark database
(the Lumen Works company seed, at the SEED_NOW clock). It signs in as the owner, Kristiina,
and for each page:

- It saves Start's own SSR HTML (`fixtures/<page>.start.html`).
- It opens the page in Chrome with every `/_serverFn/` request aborted, reads
  `window.__TSR_ROUTER__.options.context.queryClient`'s cache, and saves it with tagged
  JSON for Dates, `undefined`, Maps, and Sets (`fixtures/<page>.fixture.json`). Because the
  calls are aborted, the cache holds exactly what the server rendered with.

The pages are the timer (`/lumen/timer`), the week report (`?range=this-week`), and the
year report (`?range=custom&from=2026-01-01&to=2026-09-30`).

The reference output is the same bundle and fixture rendered in Bun. Renders are
deterministic and don't depend on the time zone: TZ=UTC and TZ=America/New_York give
identical bytes.

### Engines and harnesses

| Engine                | How                                                                          | Notes                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun 1.4.2             | `engines/bun/bench.ts`                                                       | Fresh mode uses `node:vm` contexts                                                                                                                                                |
| Bun `--smol`          | same                                                                         |                                                                                                                                                                                   |
| Bun, polyfills forced | same, `--polyfills`                                                          | Deletes the native web globals, so Bun runs the same JS polyfills the embedded engines need                                                                                       |
| V8 15.2               | `v8` crate 152.2 (rusty_v8, prebuilt static lib)                             | Default platform with one worker thread, because the single-threaded platform segfaults on heap teardown. Explicit microtask checkpoints                                          |
| V8 + snapshot         | same, `V8_SNAPSHOT`                                                          | 7.9 MB startup snapshot holding the evaluated bundle (`--make-snapshot`)                                                                                                          |
| V8, small heap        | snapshot + `--max-old-space-size=48 --max-semi-space-size=1`                 |                                                                                                                                                                                   |
| JavaScriptCore        | macOS system framework through its C API (`engines/rust/jsc`, raw FFI)       | **The JIT is on only when the binary is signed with `com.apple.security.cs.allow-jit` under the hardened runtime.** Unsigned, the framework runs in its interpreter (`jsc-nojit`) |
| SpiderMonkey 153      | `mozjs` 0.26.7 with `jit` and `intl`, prebuilt archive from Servo's releases | The host installs a job queue and drains SpiderMonkey's microtask queue itself: `UseInternalJobQueues` asserts, because `Runtime::new` has already initialised self-hosting       |
| QuickJS-ng            | `rquickjs` 0.10                                                              | Needs `render.intl.js`                                                                                                                                                            |
| Boa 0.22              | `boa_engine` with `intl_bundled` (ICU4X)                                     |                                                                                                                                                                                   |
| Perry 0.5.1520        | `perry compile` of `engines/perry/bench.ts` plus `render.mjs`                |                                                                                                                                                                                   |

The Rust harness, `engines/rust/common.rs`, is shared by every embedded engine. For each
engine and page it takes:

- Startup: create the runtime and context, and evaluate the bundle.
- The first render.
- 500 renders after 50 warm-up renders, reusing one context (QuickJS: 60 after 5; Boa: 3).
- CPU per render: process user plus system time over the loop, all threads included.
- RSS (`proc_pidinfo`): after loading the bundle, every 50 renders, at the end, and the
  peak (`ru_maxrss`).

A fresh-context mode creates a new context per render and evaluates the bundle again, 50
times. Builds are release builds. JS runs on one thread, but the engines' GC and compiler
helper threads stay on; their CPU is in "CPU ms/render". The figures are medians of 3 runs.

The load benchmark (`perf/stress/stress.ts`) was idle for every measurement. The driver,
`measure.py`, waits while it runs.

## Results

Rounded medians of 3 runs. Every column is in `results/summary.md`, and every run is in
`results/raw.jsonl`. Startup is in ms. RSS is in MB, after loading the bundle and at the
peak over 550 renders.

The "Equal to Bun" column means:

- **yes:** byte-identical to Bun's output.
- **text:** tags and hydration keys are identical, and only Intl-formatted text differs
  (see the failures section).
- **no:** the page itself is wrong.

### Timer page (266 KB of HTML)

| Engine                | Startup | First render |     p50 |  p95 | CPU/render | RSS loaded | RSS peak | Equal to Bun |
| --------------------- | ------: | -----------: | ------: | ---: | ---------: | ---------: | -------: | ------------ |
| Bun                   |      46 |           48 | **5.8** |  8.3 |        8.8 |         43 |      271 | reference    |
| Bun `--smol`          |      51 |           54 |     5.9 |  8.2 |        8.8 |         44 |      255 | yes          |
| Bun, polyfills forced |      46 |           57 |     7.9 | 10.7 |       11.7 |         43 |      321 | yes          |
| V8                    |      47 |           58 |    11.4 | 15.2 |       13.7 |         53 |      259 | yes          |
| V8 + snapshot         | **7.6** |           66 |    11.4 | 15.5 |       13.6 |     **29** |      264 | yes          |
| V8, small heap        |     7.6 |           70 |    22.9 | 25.1 |       37.2 |         29 |  **152** | yes          |
| JSC (JIT)             |      61 |           71 |    13.2 | 15.7 |       16.9 |         47 |      366 | yes          |
| JSC (no JIT)          |      63 |          123 |    82.5 | 86.8 |       89.5 |         43 |       72 | yes          |
| SpiderMonkey          |      97 |           47 |    10.3 | 14.3 |       11.7 |         55 |      348 | yes          |
| QuickJS + FormatJS    |     508 |         1107 |     984 | 1065 |        988 |         70 |      104 | yes          |
| Boa                   |    1633 |          361 |     336 |  346 |        338 |        205 |      212 | **no**       |

### Week report (147 KB)

| Engine                | Startup | First render |     p50 |  p95 | CPU/render | RSS loaded | RSS peak | Equal to Bun |
| --------------------- | ------: | -----------: | ------: | ---: | ---------: | ---------: | -------: | ------------ |
| Bun                   |      46 |           36 | **3.6** |  5.9 |        6.0 |         44 |      207 | reference    |
| Bun `--smol`          |      53 |           38 |     3.7 |  6.0 |        6.0 |         44 |      207 | yes          |
| Bun, polyfills forced |      47 |           41 |     4.6 |  7.1 |        7.6 |         43 |      266 | yes          |
| V8                    |      49 |           44 |     6.1 | 10.4 |        8.9 |         53 |      247 | text         |
| V8 + snapshot         | **7.6** |           55 |     6.2 |  9.8 |        8.8 |     **29** |      244 | text         |
| V8, small heap        |     7.3 |           58 |    11.8 | 15.1 |       17.9 |         29 |  **144** | text         |
| JSC (JIT)             |      60 |           60 |     8.0 | 10.2 |       10.7 |         47 |      295 | yes          |
| JSC (no JIT)          |      63 |           88 |    48.0 | 52.0 |       52.2 |         43 |       68 | yes          |
| SpiderMonkey          |      97 |           32 |     6.7 | 10.3 |        8.0 |         55 |      307 | text         |
| QuickJS + FormatJS    |     534 |          565 |     327 |  347 |        327 |         71 |      111 | text         |
| Boa                   |    1615 |          370 |     355 |  362 |        356 |        206 |      213 | **no**       |

### Year report (385 KB, the heavy case)

| Engine                | Startup | First render |     p50 |   p95 | CPU/render | RSS loaded | RSS peak | Equal to Bun |
| --------------------- | ------: | -----------: | ------: | ----: | ---------: | ---------: | -------: | ------------ |
| Bun                   |      47 |           41 | **6.2** |   8.5 |        9.1 |         43 |      260 | reference    |
| Bun `--smol`          |      52 |           46 |     6.1 |   8.4 |        9.0 |         44 |      257 | yes          |
| Bun, polyfills forced |      47 |           50 |     9.1 |  12.7 |       13.3 |         44 |      356 | yes          |
| V8                    |      48 |           63 |    16.6 |  18.8 |       19.8 |         53 |      265 | text         |
| V8 + snapshot         | **7.7** |           73 |    16.7 |  18.8 |       19.9 |     **29** |      266 | text         |
| V8, small heap        |     7.2 |           72 |    26.2 |  34.2 |       39.2 |         29 |  **150** | text         |
| JSC (JIT)             |      61 |           73 |    17.0 |  19.6 |       20.9 |         47 |      407 | yes          |
| JSC (no JIT)          |      64 |          155 |   115.5 | 119.5 |      125.3 |         43 |       77 | yes          |
| SpiderMonkey          |      98 |           43 |    12.2 |  19.1 |       14.3 |         56 |      348 | yes          |
| QuickJS + FormatJS    |     474 |          905 |     649 |   675 |        650 |         71 |      121 | text         |
| Boa                   |    1627 |          413 |     397 |   399 |        394 |        208 |      217 | **no**       |

Perry has no row, because the bundle doesn't compile (see the failures section).

### Memory over time

RSS on the year report with one context reused, sampled every 50 renders:

| Engine         | RSS (MB)                             |
| -------------- | ------------------------------------ |
| Bun            | 80 → 176 → 198 → 240 → 251           |
| V8             | 113 → 202 → 216 → 221 → 228          |
| V8, small heap | 83 → 95 → 109, flat from 200 renders |
| JSC (JIT)      | 106 → 259 → 341 → 386 → 388          |
| SpiderMonkey   | 91 → 269 → 311 → 320 → 332           |

Every curve flattens, so the renders don't leak; the GC lets the heap grow to its default
targets. V8 is the only engine where the heap was capped here, and a cap costs 1.6–2× in
render time because the GC runs more often.

With a fresh context per render:

| Engine          | New context + bundle |  Render p50 | RSS                                                                                                     |
| --------------- | -------------------: | ----------: | ------------------------------------------------------------------------------------------------------- |
| V8 + snapshot   |           6.7–7.7 ms |    22–45 ms | Flat at 67–88 MB, peak 89. The lowest and flattest of all                                               |
| V8, no snapshot |             39–41 ms |    42–58 ms | Flat at 77–98 MB                                                                                        |
| Bun (`node:vm`) |                 6 ms |    23–34 ms | Grows to 320–380 MB                                                                                     |
| JSC             |                13 ms |    24–34 ms | Grows to 390–540 MB, because contexts are released but collected late                                   |
| SpiderMonkey    |                84 ms |    26–37 ms | Grows to 0.8–1.15 GB, because the harness doesn't force a GC between globals. A real host would have to |
| QuickJS         |           520–560 ms | 570–1120 ms | Flat at about 90 MB                                                                                     |

The render is 2–4× slower in a fresh context, because the JIT starts cold each time.

### Binary size and build time

Release builds, cargo `-j 2` under `nice`, with registries already downloaded.

| Engine       |  Binary | Clean build | Notes                                                                                                                                                                      |
| ------------ | ------: | ----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun          |   62 MB |           – | The `bun` binary                                                                                                                                                           |
| V8           |   59 MB |        38 s | Prebuilt `librusty_v8` download. The snapshot file is another 7.9 MB                                                                                                       |
| JSC          | 0.55 MB |         5 s | Links the system framework. On Linux this would be WebKitGTK's `libjavascriptcoregtk` (~25 MB plus its ICU), or Bun's prebuilt WebKit (oven-sh/WebKit) through its C++ API |
| SpiderMonkey |   37 MB |        50 s | Prebuilt archive; building from source would take hours                                                                                                                    |
| QuickJS      |  1.6 MB |        31 s | The bundle grows to 5.3 MB with FormatJS                                                                                                                                   |
| Boa          |   27 MB |  2 min 36 s | Includes ICU4X data                                                                                                                                                        |

The render bundle itself builds in about 1.5 s.

## Failures and differences

### Correctness, the decisive part

- **Boa 0.22:** `Intl.DateTimeFormat.prototype.formatToParts` is missing. `wallClock` in
  `src/lib/calendar.ts` needs it, so every loader that computes a local date throws, and
  every page renders the error page ("This page didn't load"). Boa is also 50–100× slower
  than V8 and starts in 1.6 s with 205 MB of RSS.
- **QuickJS:** it has no `Intl`. Without a polyfill, the bundle fails while loading, at
  Kobalte's `new Intl.Locale(...)` in `isRTL` (`Intl is not defined`). With FormatJS
  (Locale, PluralRules, NumberFormat, DateTimeFormat with every time zone, ListFormat)
  plus a code-unit `Collator`, it renders every page correctly, apart from the CLDR
  differences below.
- **Perry 0.5.1520** (commit `381045a8735f`, released 2026-09-11; Perry's main branch is
  3,337 commits ahead): the bundle fails to compile.

  ```
  Error compiling module 'dist/render.mjs' ... lowering function 'getNodeMatch':
  lowering body of 'getNodeMatch': ArrayPush(12121): local not in scope
  ✗ 1 module(s) failed to compile — REFUSING TO LINK
  ```

  The cause is any push of an object literal onto an array created from object literals.
  The six-line `engines/perry/repro-array-push.ts` reproduces it:

  ```ts
  const stack = [{ v: 1 }]
  stack.push({ v: 2 })
  ```

  TanStack Router's matcher (`getNodeMatch`) does this, and so does a great deal of other
  code. No runtime result exists, so nothing is known yet about getters on props,
  `mergeProps`, Intl (whether the release has its `intl-*` features on), or speed. The
  whole-server attempt is in the next section.

  `./run-perry.sh` reruns the whole Perry column after a release: compile, 3 × 500 renders
  per page, `/usr/bin/time -l` peak RSS, and byte comparison. Its log goes to
  `results/perry-<version>.log`. Building Perry's main branch needs nightly-2026-08-20 Rust
  and LLVM 22 development files; Homebrew has only LLVM 23, so main wasn't tried.

- **V8 and Bun's other platform rough edges, for the record:**
  - V8 needs `Request` to exist when the bundle loads (better-auth's client) and
    `TextEncoder.encodeInto` (router-core's stream transform). Both are covered by the
    prelude.
  - V8's single-threaded platform crashes when the isolate is torn down.

### Perry on the whole Start server (timeboxed, 30 minutes)

`./run-perry.sh --server` compiles a copy of main's `.output/server/index.mjs`. Perry
0.5.1520 lowers the server in 11 minutes and 2.4 GB of RAM, and the build then fails
before linking:

- **111 of 113 modules compile.** That includes Better Auth, Drizzle, and the app's
  server code.
- **2 modules fail.**
  - `_libs/@tanstack/router-core+[...].mjs` hits the same `getNodeMatch` `ArrayPush` bug.
  - `_ssr/ssr.mjs` fails at native IR construction:
    `js_closure_alloc_singleton(@__perry_wrap_perry_fn__ssr_ssr_mjs__setCookie_1)` refers
    to an unknown global.
- **Perry leaves one native-addon package out of AOT routing.** That is `@libsql/client`'s
  native binding, so the database layer would need a Perry-native SQLite driver (it ships
  `perry-ext-better-sqlite3`).
- **422 "unknown identifier, assuming global" warnings**, for browser globals in the
  client code that Start bundles into the server (`ResizeObserver`,
  `IntersectionObserver`, `Image`, ...). They are harmless unless that code runs.

No binary was produced, so nothing served a request. The full log is in
`engines/perry/server/compile.log`, rerun it with `./run-perry.sh --server`. As with the
render bundle, the first blocker is a codegen bug, not a missing feature. The release is
three weeks and 3,337 commits behind Perry's main, so the result should be checked again
after the next release before it counts against replacing the Rust port.

### Text differences, not failures

V8 (its bundled ICU), SpiderMonkey (ICU4X), and QuickJS (FormatJS) use newer CLDR data than Bun
and the macOS JSC (ICU 76). On the week report, the column headers built from
`{ weekday: 'short', day: 'numeric' }` in English come out as "28 Mon" where Bun has
"Mon 28". FormatJS also puts thin spaces around the en dash in date ranges
(`Sep 28 – Oct 4`). Node 24 (ICU 78) agrees with V8. Chrome is V8, so Bun's server
output already differs from what Chrome's client would render.

Hydration doesn't patch static text, so the server's text stays on the page. This isn't a
hydration failure, but it means "byte-equal" across engines depends on the ICU version, not
only on JS semantics. Every engine's tags and hydration keys are identical to Bun's on
every page.

## Comparison with Start's own SSR

Measured with `compare-start.py <page>`, after blanking script contents and normalising the
nonce. The spike's HTML matches Start's (main's build, the same commit as
`../snowtime-079-base`) on all three pages, with these differences:

- **Body:** the markup is identical: every tag, attribute, text node, and `data-hk`
  hydration key (1,555–5,573 tokens per page). Start streams and the spike renders to a
  string, but the result is the same because the cache already holds every query.
- **Head:** identical except the nonce value in `csp-nonce` (`spike-nonce` here).
- **Scripts:** the same 10 scripts in the same order.
  - The `$_TSR` router dehydration differs only in timestamps (`updatedAt`,
    `dataUpdatedAt`, `dehydratedAt`, and two `new Date(...)` values in the session data).
    Start's clock runs from SEED_NOW, while the spike's stays fixed at it.
  - Seroval's stream-runtime source text differs in whitespace (`!0` versus `true`),
    because it's a function's `toString()` and Start's build is minified.

## What a hydrating client needs, and whether Start's client accepts this HTML

Beyond the HTML markup, Start's client needs four things from the server:

1. **Solid's hydration keys** (`data-hk`) and markers (`<!--$-->`, `<!--!$e…-->`). They
   come from the component tree, so the server bundle must split route components exactly
   like the client build (the router plugin's `autoCodeSplitting`). Otherwise every key
   below the first split route is off by one level. Also needed: Solid's `_$HY` bootstrap
   script (`<HydrationScript/>`) and anything Solid serialises into `_$HY.r` (errors from
   error boundaries).
2. **Router-core's `$_TSR` bootstrap** and the dehydrated router, serialised with seroval:
   - every match's id, status, `updatedAt`, `__beforeLoadContext` (the session), and
     loader data;
   - the client manifest of preloads and scripts per route (this spike takes it from
     Start's build);
   - `dehydratedData.query`, which `setupRouterSsrQueryIntegration` fills with the
     dehydrated QueryClient (`initial`) and a `ReadableStream` for late queries.

   None of this is Start-specific: it is `@tanstack/router-core/ssr/server`
   (`attachRouterServerSsrUtils`, `transformHtmlStringWithRouter`) and works without
   Start's request plumbing.

3. **The client entry script** and modulepreloads from the manifest, with the page's nonce.
4. **Start's serialization adapters** (`src/start.ts`'s AppError adapter), used in
   dehydration only when an AppError is in the state.

**Start's client hydrates a non-Start render.** `capture/hydrate-check.ts` serves Start's
build and swaps the spike's HTML in for the document request. The results are the same as
for Start's own HTML on every page:

- no console errors;
- the same number of `data-hk` elements after hydration (610, 434, and 1,376);
- the same 5 server elements replaced (client-only parts in both cases);
- a header link then navigates on the client without a reload.

The server side of the contract for a Rust host comes down to this: the URL, the query
data as JSON (what the API already returns), the locale, the nonce, and the build's
manifest. The bundle does the rest.

## Recommendation for task 081

**Don't embed a JS engine in the native server.** The reasons:

1. **Memory breaks the target.** Task 081 aims at under 64 MB of RSS for the whole server
   (32 MB ideally), SQLite's cache included.
   - The best idle case, V8 from a snapshot, is 28 MB before its first render.
   - Under back-to-back renders the JIT engines settle at 200–400 MB.
   - Capping V8's heap gives 110–150 MB at 1.6–2× the render time.
   - A fresh V8 context per request stays flat at 70–90 MB, but renders 2–4× slower.

   No configuration measured here leaves room for the Rust server's own data.

2. **The engines that are small aren't usable.** QuickJS (1.6 MB, about 90 MB of RSS) takes
   0.3–1 s per render and needs a 2.7 MB Intl polyfill with approximate collation. JSC
   without its JIT takes 48–116 ms. Boa renders wrong pages. Perry doesn't compile the
   bundle yet.
3. **Embedding costs more than the binary.**
   - V8 adds 59 MB to the binary, and SpiderMonkey 37 MB.
   - JSC on Linux means WebKitGTK's library or Bun's prebuilt WebKit, with C++ glue.
   - The prelude's polyfills cost 30–45% of render time on Bun (`bun-polyfills` against
     `bun`), and the gap probably accounts for much of V8's distance from Bun.
   - Output also depends on the engine's ICU version.
4. **Rendering isn't needed.** Task 079's shells already move HTML out of the server.
   - The warm-load regression in 079 comes from the data arriving later, not from HTML.
     Subtask 04 fixes that without JS on the server: the Rust server writes the first
     load's API JSON into the shell, and the client seeds its QueryClient from it, the same
     `hydrate()` this spike uses.
   - That gives most of SSR's time-to-content benefit at a few hundred µs of Rust per
     page.
   - It keeps the "native server renders no HTML" decision.
5. **If real SSR is wanted later, use a sidecar, not an embedded engine.** For example,
   for a public page that must render with content, or for Vercel parity: this render
   bundle in a long-lived Bun process, fed the API JSON over a Unix socket.
   - It takes 4–6 ms per render, starts in about 50 ms, and needs 45 MB idle and about
     250 MB under load (`--smol` saves little).
   - Its memory belongs to a separate process that can be capped, restarted, or turned off
     on small hosts, and the Rust server stays inside its budget.
   - Among embedded options, V8 with a startup snapshot is the only serious one: 8 ms
     startup, and 6–17 ms renders on par with SpiderMonkey. Its memory rules it out here.

### Changes to the TypeScript app this would ask for

None for subtask 04 beyond what 079 already plans: a seeded `hydrate()` from inline JSON.

For a sidecar, the stubs in `bundle/vite.config.ts` work, but they would be cleaner if the
app kept server-only imports out of client modules. Today `*.functions.ts` files import
`~/db` and `*.server.ts` statically, and Start's plugin removes them; a plain build needs
the import rewriting. A sidecar would also need either Start's manifest at build time or a
small manifest export.

## Reproduce

All paths are under `temp/ssr-spike/` in the worktree.

1. `bun capture/capture.ts`: builds main through `perf/lib`, then writes the fixtures and
   Start's HTML.
2. `bun capture/manifest.ts`: writes the client manifest.
3. `./build-all.sh`: builds the bundles, every engine binary, the signed JSC binary, and
   the V8 snapshot.
4. `python3 measure.py --runs 3`, then `python3 summarize.py > results/summary.md`. To run
   only some engines, pass `--only v8,jsc`.
5. `python3 compare.py v8 jsc spidermonkey quickjs boa`: compares each engine's output with
   Bun's.
6. `python3 compare-start.py week`: compares the spike's output with Start's.
7. `bun capture/hydrate-check.ts bun`: the hydration check in Chrome.
8. `./run-perry.sh [--server]`: the Perry column, rerunnable after a release.
