# Performance harnesses

Checks that measure what the app sends, what the server reads, and what the scene draws,
so a change can show its effect in numbers (task 069). There are four harnesses:

| Command                | Needs           | Measures                                                 |
| ---------------------- | --------------- | -------------------------------------------------------- |
| `bun run perf`         | Nothing but Bun | Bundle budgets, query plans, report rows and bytes       |
| `bun run perf:pages`   | Chrome          | Page bytes, DOM nodes, hydration, long tasks, input      |
| `bun run perf:load`    | Nothing but Bun | Server response times, requests per second, CPU, and RSS |
| `bun run perf:weather` | Chrome          | Weather GPU and CPU time per frame, golden frames        |

## Gated and reported

No machine here gives stable timings, so the harnesses fail only on counts that don't
depend on the machine: bytes, rows, query plans, DOM nodes, and pixels. Timings are
printed, never gated. To compare timings, run the old and the new code in the same session,
alternating, and compare ratios.

Committed baselines hold counts only, never timings from one machine.

## The benchmark data

Every harness that reads data uses the demo seed plus the company seed (`src/db/seed.ts`
and `src/db/seed-company.ts`): Lumen Works, 18 members, about 20,000 entries over a year.
`perf/lib/database.ts` seeds it into `perf/.cache/company-<hash>.db` and reuses the file
until the seed, the schema, or the migrations change.

The data is seeded against a fixed moment, `SEED_NOW` (Wednesday 30 September 2026, 07:30
UTC), so the counts are the same on any day. `perf/lib/clock.ts` moves the server's and the
browser's `Date` to that moment and lets it run from there. Timers and `performance.now()`
stay real.

| User     | Email                         | Sees                |
| -------- | ----------------------------- | ------------------- |
| `admin`  | `kristiina@lumen.example.com` | Every entry (owner) |
| `member` | `liis@lumen.example.com`      | Only their own      |

## The production build

`perf/lib/app.ts` builds the app with `vite build`, copies `.output` to
`perf/.cache/build`, and serves it on a free port. Nothing uses port 3000. Each server
runs on its own copy of the database, so writes in one run don't reach the next. The
scene's background and weather are off for every user unless a harness asks for them.

The server runs with `NODE_ENV=development`, which only turns on password sign-in; the code
is the production build. It runs from an empty folder, so the repository's `.env` files
don't reach it.

The running timers the seed leaves are stopped at `SEED_NOW`, because a running timer's
elapsed time would change the report totals, and so the bytes, on every request.

## Quick checks: `bun run perf`

Builds the app and checks three things against the files in `perf/baselines/`. It needs no
browser and takes about 10 seconds with a seeded database. CI runs it.

| Check          | Measures                                                               | Fails when                                              |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Bundle budgets | Gzipped JS per route, gzipped CSS, and the server bundle's size        | A number grows by more than 1% or 200 bytes             |
| Query plans    | `EXPLAIN QUERY PLAN` of every statement the hot server functions run   | A plan gains a `SCAN time_entry` or a `USE TEMP B-TREE` |
| Report reads   | Rows returned and result bytes of the report calls, per range and user | Rows grow, or bytes grow by more than 1% or 200 bytes   |

Each check prints the change against the baseline, pass or fail. A number that shrinks
never fails.

- **Bundle budgets:** a route's JS is the client entry, the chunks that the root and parent
  routes preload, the route's own chunks, and every chunk they import statically. The
  routes come from TanStack Start's manifest in the server build. A dynamic `import()` is
  its own lazy load and isn't counted. The server size leaves out `server/node_modules`,
  the traced native packages the code doesn't change.
  A new feature is expected to grow its route past the budget. The failure lists the chunks
  that grew, so the growth can be told apart from an accident: a feature's own chunk is
  expected, growth in a chunk that every route loads is not. Accept it with `--update` and
  commit the new baseline with the feature.
- **Query plans:** the script runs the real server functions (`resolveScope`,
  `getRunningTimer`, `listEntries`, `getReport`, `getReportEntries`), records every SQL
  statement they send, and explains each one, so a changed query is followed without
  editing the harness. Other plan changes are printed as notes.
- **Report reads:** `getReport`, `getReportBreakdown`, and `getReportEntries` (by day and by
  description) for a week, a month, and a year, as `admin` and as `member`. Rows are the
  rows the statements returned, not the rows SQLite visited, which libsql doesn't expose.
  The time per call is the median of 5 runs after one warm-up.

## Pages: `bun run perf:pages`

Loads pages of the production build in the installed Chrome (`channel: 'chrome'`; nothing
is downloaded) and counts what they send. It signs in as `admin` and opens `/lumen/timer`,
`/lumen/reports` for this week and this year, `/lumen/settings`, and `/sign-in` signed
out, each in a fresh context with an empty cache. The viewport is 1440 × 900 at pixel ratio
1.5, with a 4× CPU slowdown. A default run takes about 25 seconds.

| Number                      | Kind     | How it's measured                                                                                                    |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| HTML bytes, raw and gzipped | Gated    | The document, with the request's CSP nonce and the router's timestamps replaced by text of the same length           |
| JS and CSS, gzipped         | Gated    | Every script and stylesheet loaded until a second after hydration, gzipped at level 9 (the preview doesn't compress) |
| DOM nodes                   | Gated    | Elements after hydration                                                                                             |
| Time to hydrate             | Reported | When Solid hydrated the last server-rendered element (`_$HY.completed`)                                              |
| Long tasks                  | Reported | Count and total from a `longtask` observer                                                                           |
| Interactions                | Reported | Start the timer, open an entry's project field, step the report range back: input to the next paint, median of 3     |

A gated number fails when it grows by more than 1% (and 200 bytes, for bytes). The sign-in
page shows the scene whatever the settings say, so its numbers include the scene. The
timer page runs last, because starting the timer writes entries the reports would show.

- `--no-build` reuses `perf/.cache/build`.
- `--scene` turns the background and weather on, to see what they add. It prints the
  numbers without comparing them.

## Server load: `bun run perf:load`

Measures one server process rendering signed-in pages, to size a self-hosted server
(task 075, `docs/deployment/self-hosted.md`). It signs in as `admin` over HTTP, with no
browser, and requests `/lumen/timer`, `/lumen/settings`, and `/lumen/reports` for this
week and for 2026-01-01 to 2026-09-30. Nothing is gated. A run takes about 40 seconds.

For each page, after 5 warm-up requests:

| Number      | How it's measured                                                          |
| ----------- | -------------------------------------------------------------------------- |
| p50, p95    | 30 requests one after another, until the last byte                         |
| req/s at 10 | 8 seconds with 10 requests in flight, the count divided by the time        |
| p95 at 10   | The same 8 seconds                                                         |
| CPU/req     | The server's CPU time (user plus system) over the phase, per request       |
| RSS         | At the end, and the peak: `VmHWM` on Linux, sampled every 100 ms elsewhere |

The load generator shares the machine with the server, so on a laptop read the numbers as
ratios between runs. CPU per request is the number that carries over to another machine.

```sh
bun run perf:load                                        # the build under Bun
bun run perf:load --no-build                             # reuses perf/.cache/build
bun run perf:load --executable=dist/snowtime-linux-arm64/snowtime
bun run perf:load --url=http://127.0.0.1:3100 --pid=<server pid>
```

- `--executable` runs a compiled server from `bun run build:binary` on a copy of the
  benchmark database. The executable can't take `clock.ts`, so it runs on the real clock;
  "this week" is then the current week, not the seeded one.
- `--url` and `--pid` measure a server that is already running, for example on the
  self-hosted server. Start it on a copy of the benchmark database with
  `NODE_ENV=development`, which enables password sign-in, and set
  `update user_settings set scene_intro = 0` first. Never do this with the production
  database or on the production port.

## Weather bench: `bun run perf:weather`

Runs the app's renderer (`src/lib/scene/weather.ts`) in Chrome on a page of its own,
`perf/weather.html`, served by Vite with `perf/weather/vite.config.ts`. It needs no
database or app server. Glass surfaces sit over the canvas: plain divs with the app's
`.surface` and `.scene-header` CSS, placed as on the real pages at 1440 × 900
(`perf/weather/layouts.ts`). A default run takes under a minute and has two halves.

**Golden frames.** Chrome under SwiftShader, its software WebGL, draws each case at 0, 7.5,
and 60 seconds of weather time (`drawAt`), at 720 × 450 and pixel ratio 1 on a plain
background. The weather is a function of time only, so the frames repeat exactly. A frame
fails when more than 20 pixels change by more than 8 of 255 in a channel: loose enough for
another Chrome's rounding, tight enough that 5% larger snowflakes fail. A failing frame is
saved to `perf/.cache/weather/` for comparison.

**Timing.** Chrome on this machine's GPU (headless Chrome uses it on macOS). Nothing is gated.

- Uncapped (`--disable-gpu-vsync --disable-frame-rate-limit`, renderer pacing off): frames
  per second, and median GPU time per frame (`EXT_disjoint_timer_query_webgl2`) and CPU
  time per frame. The page lets at most 64 frames queue on the GPU, since Chrome would
  otherwise accept thousands a second and stall later.
- Paced, as the app runs: frame rate, and busy milliseconds per second on the page's main
  and compositor threads, the display compositor (viz), and the GPU process, from a trace.
  The glass's backdrop blur shows up in viz and the GPU process.

A case is a preset from `IMAGE_WEATHER` with the tuning fields that take other paths
through the shaders (`band`, `zones`, `shear`, `gather`, `share`, `glow`), drawn with its
image that has the most items: 25 cases (`FEATURES` in `perf/weather.ts`). Timing uses the
timer layout at pixel ratio 1.5 and calm pace.

```sh
bun run perf:weather                           # golden frames, then timing
bun run perf:weather --golden                  # golden frames only
bun run perf:weather --timing --layout=reports --dpr=1
bun run perf:weather --timing --all            # every layout at pixel ratios 1, 1.5, 2 (about 9 minutes)
bun run perf:weather --only=mist               # cases whose name or preset contains "mist"
bun run perf:weather --timing --swiftshader    # timing on the weak-GPU proxy
bun run perf:weather --timing --headed         # paced, in a window at the screen's refresh rate
```

### Compare two variants

`--variant` more than once opens a page per variant, passes the name as the `variant` URL
parameter, and alternates between them within each case:

```sh
bun run perf:weather --variant=current --variant=fast
```

`perf/weather/bench.ts` reads the name and picks what to draw, for example through an
option of `createWeatherRenderer`. With `--golden`, each variant is compared with the
committed frames.

### Look at a case by hand

```sh
bunx vite --config perf/weather/vite.config.ts --port 5199
```

Then open `http://localhost:5199/weather.html` with these parameters:

| Parameter  | Values                                                      | Default      |
| ---------- | ----------------------------------------------------------- | ------------ |
| `image`    | An image ID, such as `coast-november`                       | `winter`     |
| `preset`   | A preset name, such as `blowing`, without an image's tuning |              |
| `theme`    | `light` or `dark`                                           | `light`      |
| `pace`     | `full` (sign-in page) or `calm` (app pages)                 | `calm`       |
| `layout`   | `none`, `sign-in`, `timer`, or `reports`                    | `none`       |
| `photo`    | `1` shows the image's photo, tint, and vignette             | off          |
| `dpr`      | Canvas pixel ratio                                          | the screen's |
| `uncapped` | `1` draws on every frame                                    | off          |
| `t`        | Seconds: draws only the frame at that time                  | runs         |
| `variant`  | Passed to the code under test                               |              |

For example, `weather.html?image=coast-november&theme=dark&layout=timer&photo=1` shows
November's coast mist by night under the timer page's cards.

## Update a baseline on purpose

When a change moves a gated number for a reason you accept, or an optimization lowers one,
rewrite the baseline and commit it with the change, saying why in the commit:

| Baseline                                                  | Command                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `perf/baselines/budgets.json`, `plans.json`, `reads.json` | `bun run perf --update`                                                      |
| `perf/baselines/pages.json`                               | `bun run perf:pages --update` (run it twice first; the numbers must repeat)  |
| `perf/golden/*.png`                                       | `bun run perf:weather --golden --update`, after Kait signed off the new look |

`perf:weather --update` deletes frames of cases that no longer exist, unless `--only`
limits it to some cases.
