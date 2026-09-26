# 057: Timer opening cost

Status: todo

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

- [ ] A Performance trace splits the task into script, style, and layout, recorded here
- [ ] Opening the timer with cached data takes under 50 ms of main-thread work at 1×, with
      the 4× figure recorded, before and after
- [ ] Both layouts, compact rows, keyboard and touch editing, and "Show earlier" work as
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
