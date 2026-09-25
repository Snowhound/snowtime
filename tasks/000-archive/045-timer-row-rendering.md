# 045: Timer row rendering

Status: done

Opening the timer blocks the main thread for one frame of about 100 ms on a fast Mac, and
several times that on slower devices, because every entry row mounts a full inline editor.
Measured on 2026-09-25 on a local production build as the seeded owner (about 35 rows over
14 days): 2,700 DOM nodes, 364 inputs and buttons, 213 SVG icons.

Each row mounts a description combobox, a project select, a date picker, two time inputs
with a clock popover each, a duration, and a Continue button and dropdown menu: about five
Kobalte popovers per row, 175 on the page, though the rows are mostly only read. The
popover contents render only when opened; the cost is each root, trigger button, and icon.

Two cheaper causes are already fixed: the display formats read the session through one
signal instead of a query observer per field (`src/lib/display-format.ts`), and
`src/lib/date-input.ts` builds one Intl formatter per locale. They took the cached
navigation's rendering from 107–129 ms to 89–101 ms; the rest is the rows' components.
The background and weather aren't involved: the app frame keeps them mounted across pages.

The likely approach: render a row's fields as plain text and buttons that look the same, and
mount its editor when the row is hovered or focused, keeping the focused field's focus.
Touch needs care, since a tap that swaps the element under it can be lost.

## Result

Each row now mounts its editor only while the pointer or focus is in it, or after a tap
(`src/features/timer/row-activation.ts`). Until then, the project, date, clock, and actions
triggers are plain buttons that look the same, and `TimeInput` takes `idle` for the clock.
When a row activates, focus on a swapped button moves to the trigger that replaced it, and
a tap on one is replayed there. Inputs aren't swapped, so a field being typed in
keeps its caret. A row unmounts its editor once the pointer and focus leave it, unless one
of its popovers is open.

Measured on 2026-09-25 on a local production build as the seeded owner (35 rows over 14
days), in headless Chrome, five runs each. The table gives the longest animation frame after
clicking Timer on the Reports page, and its blocking time, in milliseconds:

| Navigation                | Before: frame | Before: blocking | After: frame | After: blocking |
| ------------------------- | ------------- | ---------------- | ------------ | --------------- |
| Not cached (after a load) | 105–124       | 49–72            | 71–87        | 15–29           |
| Cached (a second visit)   | 101–114       | 48–56            | 74–92        | 18–26           |

At rest the rows mount no Kobalte triggers; before, they mounted 175 (5 per row). The rows'
elements match the old build in position, size, color, and visibility in both layouts, with
and without compact rows, at 1440, 850, and 390 px. With Chrome's touch emulation, the first
tap on a row's project, date, or actions button opens it.

## Acceptance criteria

- [x] Before and after timings of navigating from Reports to the timer, cached and not,
      on a production build (the long animation frame's duration and blocking time)
- [x] Rows that aren't being edited don't mount popovers, selects, comboboxes, or menus
- [x] Editing works as before with mouse, keyboard (Tab into a row lands on the same field,
      and the field keeps focus), and touch (the first tap on a field acts)
- [x] Both layouts, list and table, and compact rows keep their look
- [x] `timer-view.test.tsx` passes, with tests for activating a row by focus and by pointer
