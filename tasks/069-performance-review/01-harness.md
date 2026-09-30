# 01: Performance harnesses

Status: todo

Three small harnesses that later work (and later agents) reuse instead of writing their own:
a size and query check with no browser, a page run in Chrome on the year of data, and a
weather bench page. The quick checks must finish in well under a minute, so they get run.

All of them use the company seed (`bun run db:seed --company`, about 20,000 entries over a
year, 18 members). Seeding takes time, so the harness seeds a local database file once and
reuses it until `src/db/seed-company.ts` or the schema changes (a hash of both in the file
name).

## Where it lives

A top-level `perf/` folder with a `README.md`, beside `scripts/` and `prototypes/`, with
`bun run perf` (quick checks) and `bun run perf:pages` and `bun run perf:weather` (browser
runs). Committed results are budgets and baselines of counts only, never timings from one
machine. Knip needs the new entry points.

## Quick checks (`bun run perf`, no browser)

- Budgets for a production build: gzipped JS per route (entry plus the route's chunks),
  gzipped CSS, and the server bundle size, which sets the function's cold start. Read from
  the build output; fail past a budget, print the change either way.
- Query plans: `EXPLAIN QUERY PLAN` for the hot queries (timer entries, report entries,
  report entry list, running timer, scope), checked against a snapshot. Fails on a new
  `SCAN time_entry` or a new temp B-tree for sorting.
- Report reads on the year of data: rows returned and bytes for `getReport`,
  `getReportBreakdown`, and `getReportEntries` for a week, a month, and a year, as admin and
  as a member. Gated. Time per call reported, median of several runs.

## Pages (`bun run perf:pages`, Playwright)

Playwright as a dev dependency, driving installed Chrome (`channel: 'chrome'`) so it downloads
no browser. The `ui-review` skill keeps `agent-browser` for looking at pages; this is the
committed spec it leaves Playwright for.

Against a production build (`vite preview`) with the seeded database, signed in as the
company admin, at 1440 × 900, pixel ratio 1.5, with 4× CPU slowdown through CDP:

- `/timer`, `/reports` for this week and this year, `/settings`, and `/sign-in`
- Gated: HTML bytes (raw and gzipped), JS and CSS transferred, DOM node count
- Reported: time to hydrate, long tasks and their total, and the delay of a few interactions
  (start the timer, open an entry, change the report range)
- Runs in under a minute; scene off by default so the numbers are the app's, with a flag to
  turn it on

## Weather bench (`bun run perf:weather`)

A page served by Vite (`perf/weather.html`), so it runs the real `src/lib/scene/weather.ts`,
not the copy in `prototypes/scene.js`. URL parameters pick the image and theme, pace, pixel
ratio, and a layout of surfaces over the canvas: none, the sign-in card, the timer page, and
a reports page where cards cover most of the screen. The surfaces are plain divs with the
real glass CSS.

- Uncapped frame rate: Chrome with `--disable-gpu-vsync --disable-frame-rate-limit`, the
  renderer's frame pacing bypassed by a bench flag
- GPU time per frame from `EXT_disjoint_timer_query_webgl2` where the browser offers it,
  and CPU time per frame
- A trace summary as in task 063: busy milliseconds per second on the main, compositor, and
  GPU threads, which is where the glass blur shows up
- Golden frames: the weather is a pure function of time, so a frame at fixed times (0, 7.5,
  and 60 seconds) is the same on every run under SwiftShader. The bench saves them per preset
  and compares against committed PNGs with a small tolerance. This is how subtasks 06 and 07
  show that a rewrite didn't change the look, and a deliberate change updates the PNGs.
- All presets in `IMAGE_WEATHER`, deduplicated by effect and tuning, about a second each;
  one layout and one pixel ratio by default, all of them with a flag

## Acceptance criteria

- [ ] `perf/README.md` says what each harness measures, how to run it, and how to update a
      budget or a golden frame on purpose
- [ ] `bun run perf` runs in under 30 seconds with a seeded database, and under two minutes
      from scratch
- [ ] `bun run perf:pages` and `bun run perf:weather` each run in under a minute by default
- [ ] Budgets, query plan snapshots, and golden frames committed, taken from `main` before any
      optimization, so subtasks 02 to 08 start from them
- [ ] CI runs `bun run perf`, or the task records why not (for example, the build time)
- [ ] `docs/architecture.md` points to `perf/README.md`
