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
