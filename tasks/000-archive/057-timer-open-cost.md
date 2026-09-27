# 057: Timer opening cost

Status: done

Opening the timer is the one page over 50 ms of main-thread work. Task 053 measured it on
2026-09-26 on a local production build with the seeded owner (35 rows over 14 days),
navigating to it with its data cached: one task of 79–82 ms and about 100 ms of work at 1×,
and a 406–438 ms task at 4× CPU slowdown, roughly a mid-range phone. The other pages take
25–65 ms. Task 045 already keeps the rows' popovers unmounted; the page still has 2,649 DOM
nodes, 417 inputs and buttons, and 240 SVGs.

Find where the time goes before choosing a fix. Likely options: mount only the first few days
and the rest as they scroll near, or `content-visibility: auto` on the day cards, which saves
layout and paint but not component setup.

## Acceptance criteria

- [x] A Performance trace splits the task into script, style, and layout, recorded here
- [x] Opening the timer with cached data takes under 50 ms of main-thread work at 1×, with
      the 4× figure recorded, before and after
- [x] Both layouts, compact rows, keyboard and touch editing, and "Show earlier" work as
      before; `timer-view.test.tsx` passes

## Before

Measured on 2026-09-26 at `852b688` by task 053's harness (see its subtask 06): a local
production build with the seeded owner, 1440 × 900 in headless Chrome, 3 runs each, in
milliseconds. Script, style, layout, and paint are self time, as the Performance panel
splits it; "other" is mostly the scene's weather and task overhead.

| Case                       | CPU | Longest task | Tasks     | Net of idle | Script  | Style  | Layout | Paint  |
| -------------------------- | --- | ------------ | --------- | ----------- | ------- | ------ | ------ | ------ |
| Cached, from Projects      | 1×  | 74–76        | 112–126   | 90–102      | 69–72   | 8      | 5      | 11–12  |
| Cached, from Projects      | 4×  | 290–361      | 377–455   | 337–389     | 248–320 | 29–33  | 17–23  | 34–38  |
| First visit, from Projects | 1×  | 86–98        | 165–183   | 147–163     |         |        |        |        |
| First visit, from Projects | 4×  | 364–392      | 582–609   | 533–541     |         |        |        |        |
| Cold reload                | 1×  | 96–105       | 274–287   |             | 152–162 | 17     | 13–14  | 23–24  |
| Cold reload                | 4×  | 405–529      | 1064–1267 |             | 582–727 | 88–104 | 57–69  | 96–115 |

- The cached and first-visit traces cover 1.5 s after the click; the cold reload's covers
  3 s from the reload, with about 40 ms (1×) of idle work in it.
- Cold reload timings at 1×: first contentful paint 160–200 ms, `load` 159–192 ms, and
  hydrated (heading shown, nothing `aria-busy`) 311–341 ms. At 4×: 280–292, 439–491, and
  1,035–1,257 ms.
- Script is about three quarters of the cached open; style and layout together are
  13 ms, so `content-visibility` alone would save little.

## Profile

Measured on 2026-09-27 at `8f4a1b1` with task 053's harness, extended with a CPU profile: a
production build in its own worktree, a freshly seeded throwaway database, and the seeded
owner. Task 059 measured Reports in the same session. Each run opens the timer once from
Projects, goes back, and clicks the Timer link. The trace covers the 1.5 s after the click;
3 runs, in milliseconds. The Table layout comes from the same seed with the owner's
`timer_layout` set to `table`.

| Layout | CPU | Longest task | Tasks   | Net of idle | Script  | Style | Layout | Paint | DOM nodes |
| ------ | --- | ------------ | ------- | ----------- | ------- | ----- | ------ | ----- | --------- |
| Bar    | 1×  | 72–83        | 110–119 | 87–97       | 66–76   | 7–9   | 4–5    | 11–12 | 2,656     |
| Bar    | 4×  | 351–515      | 486–659 | 409–592     | 312–447 | 37–58 | 22–36  | 46–61 | 2,656     |
| Table  | 1×  | 77–87        | 115–140 | 90–115      | 71–84   | 8–9   | 5–6    | 12    | 2,756     |
| Table  | 4×  | 428–594      | 548–694 | 471–613     | 383–534 | 39–48 | 24–30  | 34–46 | 2,756     |

The 4× runs vary more than on 2026-09-26; the machine was shared with another session.

The CPU profile (`Profiler.start`, 100 µs samples, 5 runs, source-mapped to `src/` and
`node_modules/`) attributes each sample to the nearest app frame on its stack. Bar layout,
milliseconds per open; the profile adds up to 20% overhead and counts forced style and
layout as script:

| Where the time goes                                                      | 1×   | 4×   |
| ------------------------------------------------------------------------ | ---- | ---- |
| Style and layout forced by `document.fonts.ready` in `PageTitle`         | 11.4 | 52.4 |
| Kobalte `Button` (`ui/button.tsx`), mostly `mergeProps` and `splitProps` | 10.3 | 52.2 |
| `calendar.ts` through `Intl.formatToParts`, from the rows' editors       | 9.0  | 44.1 |
| Garbage collection                                                       | 9.0  | 22.9 |
| Kobalte `TextField` (`ui/text-field.tsx`), one root per row              | 8.2  | 44.3 |
| Lucide icons: 240 SVGs, each a `Dynamic` and a `For` over its paths      | 7.8  | 53.3 |
| Entry editor (`entry-fields.tsx`, `entries.ts`), besides the calendar    | 4.8  | 33.3 |
| Entry rows (`entry-list.tsx`)                                            | 4.8  | 29.9 |
| Date and time inputs (`components/date-time/`)                           | 4.0  | 26.6 |
| Solid's effect queue and other framework code                            | 9.8  | 46.7 |
| Router, query, page title, scene, and the rest                           | 10.7 | 47.3 |
| Playwright's own locator queries (the harness)                           | 2.7  | 11.9 |
| Total sampled                                                            | 92.3 | 465  |

- Script is the cost, and it is spread over what each of the 35 rows mounts, not one hot
  function. Rows' Kobalte components (`Button`, `TextField`) and icons take 26 ms at 1×;
  most of it is Solid's props proxies (`mergeProps`, `splitProps`, `spread`) that each
  polymorphic component stacks up.
- `createEntryEditor` derives `date()`, `values()`, and `read()` as plain functions.
  `duration()`, `nextDay()`, and the time fields call them several times per row, and each
  call runs `localDate`, `localTime`, or `atLocalTime`, which format through `Intl`:
  `readEntryTimes` 4.1 ms, `values()` 2.6 ms, `date()` 1.9 ms.
- `cn` and tailwind-merge take under 1 ms in total: tailwind-merge caches repeated class
  strings. `Duration` takes 0.3 ms here.
- The Table layout costs the same plus 2.7 ms (15 ms at 4×) in `TableCell`, `TableHead`,
  and `TableRow`.
- Reading `document.fonts.ready` in `PageTitle`'s `onMount` makes Chrome run the new page's
  style recalc (2,547 elements, 5.9 ms) and layout (4.3 ms) inside the click's task. That
  is the page's normal style and layout run early, so it isn't extra work, but it adds to
  the one long task.
- At 1440 × 900, 9 of the 35 rows show above the fold, 2 of the 14 day cards.
- Shared with Reports (task 059): the forced style and layout in `PageTitle`, `Intl` calls
  from unmemoized derived functions, and the `ui/table.tsx` wrappers in the Table layout.
  Leaving the timer also costs Reports about 10 ms: Solid's `cleanNode` disposing the
  timer page's computations.

## Memoized row values

`1cb5ed6` memoizes `date`, `values`, and `read` in `createEntryEditor`, and commits read the
times again so their future check is current. In the profile the rows' calendar time falls
from 9.0 to 3.3 ms at 1×. Measured on 2026-09-27 as above, alternating the build before and
after on the same database, 2 × 3 runs per build at 1× and at 4×:

| Build  | Longest task, 1× | Net, 1× | Longest task, 4× | Net, 4× |
| ------ | ---------------- | ------- | ---------------- | ------- |
| Before | 76–93            | 101–117 | 384–556          | 432–620 |
| After  | 70–76            | 86–101  | 308–525          | 358–587 |

The machine was noisier than for the profile above (the build before measured 87–97 there),
so the rows compare only with each other. The Kobalte controls, icons, and date and time
inputs are still there; cheaper resting controls in the rows come next.

## Resting controls

`bc2f94e` renders a resting row's buttons (project, date, clock, continue, more) as native
buttons with `ui/button.tsx`'s classes (`PlainButton`), and the description as a native
input. The row still has the same inputs and buttons in the same order, so row activation
swaps in the Kobalte triggers as before. Measured on 2026-09-27, alternating the builds on
the same database, 2 × 3 runs each:

| Build                | Longest task, 1× | Net, 1× | Longest task, 4× | Net, 4× |
| -------------------- | ---------------- | ------- | ---------------- | ------- |
| Before this task     | 73–83            | 93–106  | 312–445          | 354–479 |
| Memoized row values  | 64–70            | 87–99   |                  |         |
| And resting controls | 43–48            | 59–68   | 180–341          | 243–389 |
| Same, Table layout   | 43–48            | 59–66   | 189–224          | 230–271 |

- The Table layout row is 3 runs, without an alternating run of the build before.
- In both builds, the rows look the same at rest, on hover, and after a tap (identical
  screenshots). The project and more menus and the date and clock popovers open from a
  pointer, the keyboard, and a tap, and Escape restores a typed description.
- The timer is still over 50 ms at 1×. What remains per row is mostly the icons, the time
  inputs, and the day cards themselves. Mounting only the days near the viewport would
  cover the rest.

## Days near the screen

`f66f18f` mounts a day's rows only when the day is within the first 12 rows, comes within half
a screen of the viewport, holds an entry just saved, or once Tab is pressed anywhere on the
page (`lazy-days.ts`). Until then the day holds a placeholder as tall as its rows. Both
layouts use it; the Focus layout's few days all mount at once. Measured on 2026-09-27,
alternating the builds on the same database, 2 × 3 runs each:

| Layout | Build  | Longest task, 1× | Net, 1× | Longest task, 4× | Net, 4× | DOM nodes |
| ------ | ------ | ---------------- | ------- | ---------------- | ------- | --------- |
| Bar    | Before | 40–46            | 57–64   | 168–213          | 220–274 | 2,517     |
| Bar    | After  | 21–25            | 31–39   | 91–134           | 117–167 | 936       |
| Table  | Before | 43–49            | 59–68   | 184–249          | 234–325 | 2,668     |
| Table  | After  | 24–28            | 33–40   | 101–136          | 126–166 | 1,145     |

- "Net" includes the days the observer mounts within half a screen after the first frame.
  A margin of a whole screen mounted more of them and left the Table layout at 54–62 ms.
- Checked against the build before, in the Bar, compact Bar, Focus, Table, and compact Table
  layouts at 1440 and 390 px: the page's height differs by at most 7 px at rest and matches
  once every day is mounted, and the top of the page looks the same. No placeholder shows
  while scrolling in 300 px steps. Tab from the first row visits every row in order and then
  "Show earlier", which still loads five more days. An entry moved to a day not yet mounted
  mounts that day and scrolls into view. The rows' menus and popovers open from a pointer,
  the keyboard, and a tap. A new test in `timer-view.test.tsx` covers the Tab.
- Until a day mounts, the browser's find in page doesn't see its rows.
