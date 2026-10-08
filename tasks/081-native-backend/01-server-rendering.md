# 081.01: Server rendering in the native backend

Status: in-progress (the native host serves pages, measured 2026-10-04; the memory
target agreed on 2026-10-07 awaits its Linux check)

The native backend renders pages and the browser hydrates them, as it does with today's
Start server. Rust embeds a V8 isolate that runs the app's Solid server render. Kait chose
this on 2026-10-02 over task 079's shells: a shell's warm load shows content 430–480 ms
later than a server-rendered page (task 079, "Measured"), and the spike below found
rendering cheap and hydration compatible. Task 079 is cancelled.

## Findings

### The native host serves pages, 2026-10-04

`snowtime-axum` now renders pages through the render crate
([`native/README.md`](../../native/README.md), "Server rendering"). It serves `/api/` from
the API router, public files from `EDGE_STATIC_DIR`, and every other path as a page. The
renderer's API calls go through `router.oneshot` with the page's cookie. A renderer writes
the whole page into a buffer and takes the next one; the handler sends the buffer, so a
slow client never holds an isolate. A full queue, or a page that waited longer than one
second in it, answers 503 with `Retry-After: 1`. A queued page whose client has gone is
skipped. The host renders at `PERF_NOW` when that moves its clock, so pages and API agree
on the day.

- **Ported reads.** The session (`GET /session`, with the fill summary in the user's zone
  and region), teams, members, and the report (`POST /report`) join the timer, entries,
  and projects. With them, the timer and every report page render with no recorded
  answers. Time zones come from `jiff` with its bundled zone database. The report's
  breakdown, entry lists, entry totals, and export are also ported and verified in
  [task 081.24](24-report-reads.md), including CSV and XLSX downloads on the native host.
- **Same answers.** `compare.ts` finds all 349 calls byte-equal to the TypeScript
  server, masking only each server's clock, sign-in time, and URL. They include the
  session, team, member, and all five report reads as owner and member, report filters
  and refusals, malformed report input, and Better Auth's origin and CSRF checks on
  sign-in. Task 081.24 adds case and accent ties and three pages of one busy day.
  The earlier comparison found that the TypeScript `IsoDate` check threw on a non-date
  (`"bad"`, `2026-13-01`) and answered 500; it now refuses with the date-format message.
- **Same pages.** The timer, the week, the month, and a year report render with the same
  status and markup as Start's, apart from the recorded ICU text (`28 Mon`) and the
  whitespace of one function seroval prints from source. Redirects match Start's (signed
  out to `/sign-in?redirect=…`, `/` to the timer). Chrome hydrates the timer and week with
  no errors, keeps all 610 and 434 keyed nodes, and navigates between them without a
  reload. Task 081.26 ports the signed-out `/sign-in` page's reads and sign-out;
  password sign-in and sign-out work through the native host in Chrome.
  Settings PUT/PATCH also work; Preferences saves week start and theme through a reload.

The manifest the renderer embeds must come from the build whose assets the host serves.
`bundle/build.ts` now strips it as Start's `getStartManifest` does, which drops the build
paths it carried, and copies that build's public files beside it.

#### Load on dataset M

Task 078's `perf:stress` on dataset M, set up as in [081.03](03-port-libraries.md#load-perfstress-on-m):
app, Caddy, and sampler on one shared core, the app limited to 1,792 MB, so the host sizes
one renderer. The recording is task 090's full one, cut by `api-recording.ts` to the calls
the native host serves plus the timer and report pages: every action of the usage model
but the export and the sign-in page. The TypeScript column is 081.03's run of the whole
recording, so its return carries one call more. Raw output:
[kinds](server-rendering/render-host-stress-kinds.txt),
[ramp](server-rendering/render-host-stress-ramp.txt),
[fixed 40,000](server-rendering/render-host-stress-fixed40k.txt).

Each action alone at 2 a second for 60 seconds, app CPU per action:

| Action       | Requests | Native ms | TypeScript ms (081.03) |
| ------------ | -------: | --------: | ---------------------: |
| Open (timer) |        1 |      36.8 |                     56 |
| Return       |        4 |       3.2 |                     29 |
| Timer        |        4 |       2.8 |                     31 |
| Edit         |        5 |       3.0 |                     29 |
| Week report  |        3 |       3.1 |                     26 |
| Month report |        1 |      29.0 |                     60 |
| Year report  |        1 |      46.3 |                     93 |
| Sign-in      |        6 |      81.5 |                    103 |

A page costs 1.5–2× less than Start's render, and an API action 8–10× less. The timer page's
36.8 ms includes its five API reads against dataset M and the HTTP handling, which
`render-bench`'s 17.5 ms leaves out.

The ramp, one minute a step (`--step-seconds=60 --hold-seconds=180`), before the trim
described below. CPU is a share of the one core; RSS is the step's peak and anonymous memory
its last sample; page columns are the server's p95 in ms:

|         Users | Req/s | App CPU | Caddy CPU | RSS / anon MB | Timer page | Month page | Year page |
| ------------: | ----: | ------: | --------: | ------------: | ---------: | ---------: | --------: |
|         5,000 |    89 |    9.3% |      5.2% |      142 / 56 |         52 |         54 |       225 |
|        10,000 |   179 |     16% |      8.0% |     194 / 113 |         57 |         57 |       408 |
|        20,000 |   355 |     28% |       12% |     206 / 116 |         64 |         84 |       455 |
|        30,000 |   535 |     39% |       16% |     204 / 132 |        143 |         93 |       166 |
|        40,000 |   714 |     51% |       21% |     254 / 137 |        233 |        310 |       388 |
|        50,000 |   891 |     65% |       27% |     260 / 157 |  872, miss |        934 |       849 |
| 40,000, 3 min |   712 |     53% |       21% |     303 / 176 |        319 |        332 |       216 |

- **Capacity.** The native host held its targets up to 40,000 users of this slice (714
  requests and 11 pages a second) and held them for three minutes; at 50,000 a 30-second
  window's month-page p95 reached 1,029 ms. The shared core limited it, with the app at
  65% and Caddy at 27%. The ramp saw five 5xx answers, all in the 50,000 step, and no
  others. The TypeScript server hasn't run this slice; 081.03's API-only slice isn't
  comparable, since this one adds pages, the session, and reports.
- **Memory.** Idle, the server holds 47 MB RSS (15 MB anonymous): the renderer's isolate
  exists, but the snapshot's pages are touched as pages render. Under load RSS grew to
  254 MB at 40,000 users and 303 MB in the hold. With the trim below, a five-minute run at
  40,000 users peaked at **219 MB RSS** with 114 MB anonymous at its end, within targets
  and without errors. RSS counts the binary's mapped code, about 33 MB at idle, and more as
  more of V8 runs.
- **Pressure.** With the app limited to 240 MB, the host sized one renderer with a 64 MiB
  heap and held targets at 20,000 users with 134 MB peak RSS. At 160 MB the RSS check
  fired at 137 MiB; renderers collected and trimmed after every page, RSS fell to 74 MiB,
  and pressure cleared. Targets held and nothing was killed, while the database's page
  cache shrank and disk reads rose from 4.7 to 14.8 MB/s.

#### Renderers

`render-bench` in Docker on this Mac (`debian:trixie-slim`, `--memory=2g`), against
`capture.ts`'s recorded answers, so without SQLite. Medians of three runs, after 50 warmup
pages and idle collection; RSS samples every quarter second
([pages](server-rendering/render-pool-pages.jsonl),
[renderers](server-rendering/render-pool-renderers.jsonl),
[long](server-rendering/render-pool-long.jsonl),
[heap](server-rendering/render-pool-heap.jsonl)).

One renderer on one CPU, 500 pages:

| Page  | p50 / p95 ms | CPU ms/page | Loaded / idle MiB | Peak MiB |
| ----- | -----------: | ----------: | ----------------: | -------: |
| Timer |  14.7 / 34.4 |        17.5 |       64.5 / 66.5 |      161 |
| Week  |  10.6 / 18.2 |        11.4 |       64.9 / 66.6 |      145 |

Against the channel thread above, a timer page costs 3.1 ms less CPU and a week page 2.8 ms
less. The likely causes: the body goes into a buffer instead of an awaited channel send
per chunk, and the manifest is set once per isolate instead of parsed with every page.

The timer page with 1 to 4 renderers and as many clients, on four CPUs, 1,000 pages:

| Renderers | Pages/s | p50 / p95 ms | CPU ms/page | Loaded / idle MiB | Peak MiB (range) |
| --------: | ------: | -----------: | ----------: | ----------------: | ---------------: |
|         1 |      67 |  14.6 / 18.1 |        19.1 |       66.0 / 70.5 |    156 (154–156) |
|         2 |     128 |  15.3 / 18.9 |        20.5 |       112.5 / 124 |    232 (213–267) |
|         3 |     180 |  16.1 / 20.5 |        21.3 |       158.3 / 167 |    223 (213–226) |
|         4 |     180 |  17.1 / 44.6 |        22.4 |       203.4 / 220 |    272 (268–279) |

Each renderer adds about 46 MiB loaded and 50 MiB idle, and 40–75 MiB at its peak; glibc's
retained free memory, 25–128 MiB across runs, makes peaks vary. A second renderer adds
90% throughput and a third 41%; a fourth adds nothing with the bench's clients on the same
four CPUs. CPU per page rises 4–7% a renderer as they share caches and memory bandwidth.
The host's sizing uses 256 MiB for the server with one renderer and 80 MiB for each further
one, and caps the count at the CPUs.

A 64 MiB heap limit, which the host picks below about 340 MiB, against 128 MiB, 1,000
pages each:

| Page  | Heap MiB | p50 / p95 ms | CPU ms/page | Loop / peak MiB |
| ----- | -------: | -----------: | ----------: | --------------: |
| Timer |       64 |  18.7 / 54.1 |        26.0 |        72 / 104 |
| Timer |      128 |  15.0 / 34.6 |        17.8 |       102 / 163 |
| Week  |       64 |  12.0 / 29.7 |        14.9 |        77 / 107 |
| Week  |      128 |  11.1 / 19.9 |        11.8 |        98 / 147 |

#### Late growth

The growth after the first pages is glibc's, not V8's. Before the fix, a timer loop held
152–155 MiB and 121–124 MiB after idle collection, against 65–73 MiB once warm; glibc
reported 6 MiB in use and 57–62 MiB free but kept. Over 5,000 pages RSS climbed for the
first eighth and then stayed at 150–160 MiB, so it is a plateau, not a leak.
`MALLOC_ARENA_MAX=2`, `MALLOC_MMAP_THRESHOLD_=131072`, and `MALLOC_TRIM_THRESHOLD_=131072`
changed none of it: the freed memory is many small blocks from V8's compiler and the
page's buffers, spread over thread arenas glibc doesn't trim by itself.

The renderer now calls `malloc_trim(0)` after each collection and every 64 pages. Over
5,000 pages RSS holds at 99–107 MiB and returns to 67–69 MiB idle, at the same CPU (17.4–
17.9 ms against 17.7–17.9). Trimming only after collections left one of two runs at 155 MiB,
because a run that never crossed the 48 MiB used-heap threshold never collected. glibc's
statistics still count about 55 MiB free after a trim, since released pages stay in its
lists. The 161 MiB peak remains: it comes in the first pages, while V8 optimizes on its
background threads, before the first trim. The earlier spike's 219 MB macOS and 237 MB
Linux peaks probably had the same cause; they weren't re-measured.

#### Memory target

Kait, 2026-10-07: Snowtime's own native server targets one Hetzner instance of 1 vCPU
and 2 GB. The figures below are a guideline for constrained machines, kept so the port
stays able to run in them, and a change that misses them isn't rejected for that alone.
They count the app process only, since the proxy and replication have budgets of their
own, and the peak includes startup's warmup. A Linux run of the host at its own heap and
semi-space choices confirms them, because they predate tasks 081.14 and 081.19–081.22.

The guideline, proposed on 2026-10-04: **the app with one renderer stays under 256 MiB RSS
at its peak**, at the 128 MiB heap limit, on the load it can carry on one core. Measured: 219 MB
at 40,000 users of the slice, 114 MB of it anonymous. Each further renderer may add 80 MiB.
With the host planning on 75% of its limit, one renderer needs a 384 MiB container
limit and each further one 107 MiB more; the cgroup's page cache uses the rest. Below 340
MiB the host takes a 64 MiB heap, which held targets at 20,000 users under a 160 MB limit
at 26–46% more CPU a page. The API-only 64 MB target stays for a server without a
renderer.

### Render crate and Linux measurements, 2026-10-04

The rerunnable harness is now in
[`native/crates/render`](../../native/crates/render/README.md). The crate loads the app's
2.38 MB server bundle from a V8 snapshot (`deno_core` 0.405.0, V8 14.9.207.2-rusty).
This section measured its first version, which returned HTML chunks through bounded
channels and offered an Actix worker; the host integration above replaced both.

- **Timer and week report render and hydrate.** V8 emits 256,567 and 141,458 bytes on the
  Lumen Works seed, at `SEED_NOW`. All hydration keys match Start's build. The timer's
  body markup matches; the week differs in the already-recorded ICU text, `28 Mon`
  against macOS Bun's `Mon 28`. Chrome hydrates with no errors, keeps the original
  tracked nodes, and navigates between the pages without a reload. After hydration there
  are 610 and 434 keyed elements, matching Start's reference
  ([browser results](server-rendering/render-isolate-hydration.json)).
- **API reads go through the host.** The bundle installs `setSend(path, init)` as a host
  op carrying method, path, headers, and body. Rust response bytes become a V8
  `Uint8Array`; the app's usual decoder fills a new query cache per page. The live harness
  made 255 calls to a running native server's timer, entries, first-start, and project
  rules, and 255 to recorded responses for the unported session, team, member, and report
  reads. Neither harness pre-seeds the query cache. The standalone Axum example also
  verifies the same callback with `Router::oneshot`.
- **Deno supplies the web APIs.** `deno_web`, `deno_webidl`, `deno_fetch`, and `deno_net`
  supply URL parsing, encoding, streams, structured cloning, Request, and Response.
  Deno's streams use JavaScript backed by native ops; this is not an all-native stream
  implementation. The isolate's `fetch` throws so app reads must use the host callback.
- **Collection follows idle time and used heap.** Defaults: collect after one second
  idle or after a completed render with more than 48 MiB used heap; replace if collection
  leaves more than 80 MiB live. At the 128 MiB heap limit, terminate work and grant 16 MiB
  to unwind. A five-second watchdog stops synchronous JavaScript; an async deadline also
  covers API futures and body backpressure. Thrown, timed-out, and cancelled renders
  replace the isolate. Tests verify host fields, Unicode encoding, streamed chunks,
  synchronous interruption, and rendering again after failure.

Linux ARM64 in Docker on this Mac, `debian:trixie-slim`, `--cpus=1 --memory=2g`, wrapped
in `caffeinate -i`. Each row is the median of three runs of 500 renders after 50 warmups.
RSS uses MiB throughout this section. These runs include rendering, decoding recorded
Rust API answers, and streaming; they exclude SQLite and the API server's CPU. The
process also holds those fixture answers. Idle RSS is after 1.5 seconds and collection.
Sample ranges span all three runs; peaks are medians of process high-water marks.
[Raw renderer runs](server-rendering/render-isolate-linux.jsonl):

| Ownership      | Page  | p50 / p95 ms | CPU ms/render | Loaded / idle MiB | Loop samples MiB | Peak MiB |
| -------------- | ----- | -----------: | ------------: | ----------------: | ---------------: | -------: |
| Local isolate  | Timer |  16.3 / 38.8 |          20.0 |      36.8 / 127.6 |      102.8–168.5 |    169.5 |
| Channel thread | Timer |  17.0 / 37.8 |          20.6 |      37.2 / 124.5 |      103.2–169.0 |    168.6 |
| Local isolate  | Week  |  12.4 / 25.9 |          14.0 |      36.8 / 123.8 |       92.6–155.3 |    156.1 |
| Channel thread | Week  |  12.4 / 27.3 |          14.2 |      37.2 / 124.1 |       94.1–162.1 |    161.9 |

The channel adds 0.59 ms CPU per timer render (3.0%) and 0.20 ms per week render (1.4%).
Its loaded RSS adds 0.38 MiB. Warm RSS differs in both directions. Startup includes V8
platform initialization in each fresh process: the channel-thread median is 11.9 ms for
both pages.

The standalone HTTP hosts repeat the same workload and callback: Axum's handler awaits
one process-wide render thread; Actix's one worker owns its isolate. Both collect on idle
and memory. Both API callbacks call the fixture router with `oneshot`. Three runs per
row, alternating host order; 500 measured requests after 50 warmups. The HTTP client runs
in the same one-CPU container; its CPU is excluded using the server's `/proc` counters.
[Raw HTTP runs](server-rendering/render-isolate-frameworks.jsonl):

| Host                 | Page  | p50 / p95 ms | CPU ms/render | Idle / loop-end MiB | Peak MiB |
| -------------------- | ----- | -----------: | ------------: | ------------------: | -------: |
| Axum, channel thread | Timer |  17.8 / 40.8 |         21.34 |       131.0 / 162.7 |    170.2 |
| Actix, local worker  | Timer |  17.4 / 39.8 |         20.42 |       128.7 / 163.8 |    170.3 |
| Axum, channel thread | Week  |  12.8 / 29.7 |         14.30 |       126.5 / 159.6 |    159.9 |
| Actix, local worker  | Week  |  12.6 / 29.1 |         14.12 |       127.9 / 158.1 |    158.5 |

**Keep Axum.** It takes 0.92 ms more CPU on the timer (4.5%) and 0.18 ms on the week
(1.3%); memory is comparable. This penalty does not outweigh the chosen router's fit
with the API and better-auth-rs. A shared render thread also keeps isolate count separate
from HTTP worker count. This closes the threading question in
[081.03's decision](03-port-libraries.md#decision); mixed API/render load is still open.

### Earlier engine spike

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

Kait agreed to both on 2026-10-03. The render crate implements them on 2026-10-04
with Deno extensions and the policy measured above:

- [x] **Native web APIs in the host.** Bun renders faster than the embedded engines because
      its `URL`, `TextEncoder`/`TextDecoder`, and streams are native. With the same JS
      polyfills, Bun, Bun's JavaScriptCore, and V8 render at the same speed (see
      [Bun's WebKit](#buns-webkit)), and the polyfills cost 30–45% of render time. The host
      implements those APIs natively, or the render bundle stops needing them. Candidates
      to start from: Deno's extension crates for V8 (`deno_url`, `deno_web`, `deno_webidl`,
      MIT), the `ada-url` crate (the URL parser Node and Bun use), and Bun's implementations,
      which are tied to JavaScriptCore but show what the bundle needs.
- [x] **A GC policy driven by idle time and memory, not a fixed count.** A full GC every 10
      renders adds 50% CPU on V8 on Linux (20% on macOS, 8% on JavaScriptCore). The host
      collects when the isolate is idle, or when its memory crosses a threshold, and
      replaces the isolate from the snapshot if memory still grows.

## Open

- Check the memory target on Linux ([Memory target](#memory-target)). V8 is the engine
  since 2026-10-07, and task 081.22's minified bundle took 7–9 MB off a renderer's loaded
  RSS and 7–13 MB off its peak.
- Confirm on the Linux deployment host. These measurements are Docker on this Mac: the
  stress runs on dataset M with Caddy on the app's core, the renderer runs on the Lumen
  Works seed with recorded answers.
- Extend the functional port after [task 081.26](26-functional-port.md), which finishes
  sign-in reads/sign-out, settings, project and team writes, invitations, and issue links
  with 880 byte-equal calls. [Task 081.28](28-auth-port.md) adds invitation acceptance
  through the application API and Better Auth, including team assignments and existing
  members, then passkey registration, sign-in, listing, and removal. Google, GitHub, and
  Microsoft redirect sign-in and account management are also ported. The audited remaining
  client profile and organization writes stay follow-ups.
- Bring the 161 MiB warmup peak down if the target needs it: it comes before the first
  trim, while V8 optimizes the bundle.

## Acceptance criteria

- [x] V8 measured on Linux in task 078's container limits: RSS at idle and under load,
      CPU per render, with the GC policy chosen
- [x] A render API in the proof of concept: Rust serves the timer and week report
      server-rendered, and Start's client hydrates them
- [x] A memory target for the native backend with a renderer, agreed with Kait
- [ ] Confirmed on the Linux host: the app's peak RSS with one renderer against the
      guideline, and V8's render CPU against Bun's plain bundle on the four pages, the
      condition in native-rendering.md
- [x] The decision recorded in `docs/architecture/` with what was rejected: shells
      (task 079), a separate Bun render process, and the other engines
- [x] The renderer's harness kept where it can be re-run: `native/crates/render/`,
      rebuilt from the recorded spike because its gitignored harness was deleted
