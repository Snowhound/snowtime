# 06: Rendering and loading cost

Status: in-progress (reviewed and measured; the open-cost criteria wait on decisions below)

Task 045 found the timer page mounting a full editor in every row, about 175 popovers
for 35 rows. Check the other pages and shared components for the same kinds of cost.
Measure on a local production build with the seeded data, and on a CPU throttled 4× in
Chrome's Performance panel.

## Acceptance criteria

- [ ] No page mounts heavy components (popovers, pickers, comboboxes, editors) for
      every row or item when a lighter view would look the same until used
- [x] No per-second timer, resize, or scroll handler re-renders more than the part that
      changes
- [x] Effects that only derive values are memos, and no effect writes a signal that
      reruns it
- [x] Each query has a sensible `staleTime`, and mutations invalidate only what they
      change
- [x] The client bundle has no server-only code or large dependency that a page doesn't
      need at first load; routes split where it pays
- [ ] Opening each page stays under 50 ms of main-thread work on the fast machine,
      or the page gets a task

## Findings

Measured on 2026-09-26 on a local production build (`vite build`, served on port 3100) with
a freshly seeded throwaway database, as the seeded owner, at 1440 × 900 in headless Chrome.
CPU slowdown was set through the DevTools protocol, the Performance panel's setting. The
harness is Playwright, run from outside the repository. Each run clicks a page's link (Settings
from the user menu) after visiting it once, so the data is cached, and traces the next 1.5 s.
Numbers are the range over the runs, in milliseconds. "Idle" is the same 1.5 s with no click,
mostly the scene's weather.

| Page         | Longest task, 1× | Tasks, 1× | Idle, 1× | Longest task, 4× | Tasks, 4× | Idle, 4× | DOM nodes |
| ------------ | ---------------- | --------- | -------- | ---------------- | --------- | -------- | --------- |
| Timer        | 79–82            | 123–127   | 21–22    | 406–438          | 540–542   | 79–80    | 2,649     |
| Reports      | 19–25            | 50–68     | 22–24    | 84–110           | 170–226   | 51–61    | 550       |
| Projects     | 15–18            | 45–49     | 21–24    | 63–74            | 138–160   | 55–61    | 239       |
| Organization | 17–18            | 48–52     | 23–25    | 68–101           | 139–188   | 55–64    | 371       |
| Settings     | 44–48            | 87–95     | 21–23    | 188–194          | 330–336   | 68–69    | 795       |

- Subtracting the idle work, only Reports, Projects, and Organization open in under 50 ms
  at 1×. The timer takes about 100 ms, one task of about 80 ms, which matches task 045's
  result (74–92 ms frames). Its rows mount no Kobalte triggers, but they still have 2,649
  nodes, 417 inputs and buttons, and 240 SVGs for 35 rows. Task 057 brings it under 50 ms.
- Settings takes 66–72 ms by the table above, not under 50 ms as first recorded. Its runs
  also opened the account menu inside the trace. Measured again with the menu opened
  before the trace (3 runs): 85–91 ms of tasks after idle, longest task 48–49 ms; at 4×,
  340–383 ms, longest 205–246 ms. About 18 ms of it is the time zone list: 418 options,
  each labelled through its own `Intl.DateTimeFormat` for the offset (`zoneLabel` in
  `preferences-card.tsx`).

First visits, measured on 2026-09-26 on the same build and data. Each run loads the timer
page fresh (Projects, for the timer's own row), waits 1 s, and clicks the page's link, so
the page's code and data both load. The trace covers 1.5 s after the click; 3 runs.
"Net" subtracts an idle trace of the same length taken just before. "Content" is the time
until the page's heading shows and nothing is `aria-busy`.

| Page         | Longest task, 1× | Net, 1× | Content, 1× | Longest task, 4× | Net, 4× | Content, 4× |
| ------------ | ---------------- | ------- | ----------- | ---------------- | ------- | ----------- |
| Timer        | 86–98            | 147–163 | 174–197     | 364–392          | 533–541 | 564–594     |
| Reports      | 32–39            | 90–97   | 119–136     | 117–139          | 253–308 | 284–327     |
| Projects     | 27–34            | 65–78   | 104–111     | 76–96            | 200–235 | 239–290     |
| Organization | 29–35            | 71–84   | 101–117     | 71–103           | 222–312 | 269–346     |
| Settings     | 34               | 86–89   | 108–116     | 169–178          | 466–469 | 497–498     |

- Settings' row is from 2 runs with the menu opened before the trace. With the menu
  inside it, Settings took 154–164 ms and about 420 ms to content: Playwright waits for
  the menu's open animation before it clicks.
- A first visit costs 40–60 ms more than a cached one at 1×: the page's chunk compiling
  and running, and the query results arriving in more tasks. Most of it is script. For
  Settings at 1×, script is 62–63 ms of the 106–107 ms traced, style 8–9, layout 7,
  paint 9. No page opens in under 50 ms on a first visit.

The running timer's tick, on the timer page with the summary shown, idle, over 5 s with
the timer running and 5 s with it stopped (3 runs each). The extra work is per second.

| Build            | Extra per second, 1× | Longest task, 1× | Extra per second, 4× | Longest task, 4× |
| ---------------- | -------------------- | ---------------- | -------------------- | ---------------- |
| Before `852b688` | 2–3                  | 2                | 13–16                | 9                |
| After `852b688`  | 0–2                  | 1                | 6–19                 | 6                |

The tick was already cheap; at 4× the runs vary more than the change. `852b688` gives the
day headers today's date instead of the clock, so 14 headers no longer recompute their
label each second, and the summary's project rows keep their elements across ticks.

A cold reload of the timer page (server render and hydration) is task 057's "before",
recorded there.

Checked:

- Changed: the entry list's and table's day headers read `now` only for "Today" and
  "Yesterday"; they now take `today`, which changes at midnight. The summary was a plain
  function read by every field of `SummaryPanel`, so each tick ran `summarize` several
  times, and its `<For>` rebuilt every project row because each tick made new row objects.
  It is now a memo, and the rows use `<Index>`.
- Per-second work left: the elapsed time in the timer bar, the document title, and the
  summary's totals, which all change each second.
- Resize and scroll: the scene layer's resize handler writes two signals that change only
  when the theme or the photo width does. `PageTitle`'s and the timesheet's
  `ResizeObserver`s and the timesheet's scroll handler set a position or two booleans.
  Sound.
- Effects: every `createEffect` either touches the DOM or the world (title, favicon,
  scroll, timers, WebGL, `localStorage`) or copies a saved value into a draft signal the
  user edits, which a memo can't hold. The timer's midnight effect writes `now`, which
  reruns it once with the new day and then waits for the next midnight. Sound.
- `staleTime`: 30 s by default, so hydrated data isn't fetched again. Projects, teams, and
  members keep 5 minutes, because the app's own writes update them. The app URL and the
  sign-in methods never change while the app runs. Sound.
- Invalidations: each `optimistic` mutation refetches the caches it updated and lists in
  `invalidate` only what it changes but can't update (reports, the earliest entry). Reports
  take project and team names from the cached lists, so renaming a project doesn't need to
  invalidate them. Sound.
- Bundle (`bun run build`): each route has its own chunk (timer 80 kB, Organization 47 kB,
  Projects 33 kB, Settings 30 kB, Reports 27 kB, before gzip). No client chunk holds
  libSQL, Drizzle, Kysely, or Better Auth's server code. The XLSX writer (70 kB) loads
  only when a report is exported. A cold load of the timer fetches 694 kB of JavaScript in
  40 files, mostly Solid, the router, TanStack Query and Form, Kobalte, and Paraglide. It
  includes the 53 kB Better Auth client, which the app frame needs for the passkey prompt
  and the organization switch. Loading it on demand would put an `await import()` before
  `addPasskey`, which Safari may refuse as no longer inside the user's gesture, so it
  stays.
- Rows: Reports' timesheet rows are plain cells. Projects' rows and the Organization
  view's team cards each mount a Kobalte `DropdownMenu` root and trigger; the menu's
  content mounts only when opened. With the seeded data these pages open in 15–25 ms
  (cached), so the menus stay. An organization with hundreds of projects would call for
  the timer's row activation (task 045).

The harness is Playwright with Chrome, run from outside the repository, against
`vite build`'s output served by Bun on port 3100 with a seeded throwaway database. It
sums `RunTask` events on the renderer's main thread from a Chrome trace, and splits their
self time into script, style, layout, and paint as the Performance panel does.
