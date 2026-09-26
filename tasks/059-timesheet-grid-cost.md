# 059: Timesheet cost with many rows

Status: in-progress

Opening Reports with cached data on a month by project with 40 projects takes 77–89 ms of
main-thread work at 1× before task 055's Entries card, and 89–98 ms with it (task 055,
Findings). Task 053's 50 ms limit held only for the seed's five projects. Each of the
grid's 1,200 cells renders a `Duration` (a `Show` and a `For`) inside a `TableCell` whose
classes go through `cn`, which runs tailwind-merge. Those are the first suspects.

## Acceptance criteria

- [x] A profile of the cached visit names what the grid's time goes to
- [ ] Opening Reports on a month by project with 40 projects stays under 50 ms of
      main-thread work at 1×, measured as in task 055, with the 4× figure recorded
- [ ] The grid looks and reads the same, with the Entries card's buttons working as before

## Profile

Measured on 2026-09-27 at `8f4a1b1` as in task 055: a production build in its own worktree,
a freshly seeded throwaway database with task 055's 40 Northwind projects and 1,064
entries, and the seeded owner. Reports opens on this month by project, 40 rows of 30 days,
By description. Each run opens Reports once from the timer, goes back, and clicks the
Reports link; the trace covers the 1.5 s after the click. 3 runs, in milliseconds. Task 057
profiled the timer in the same session.

| CPU | Longest task | Tasks   | Net of idle | Script  | Style | Layout | Paint | DOM nodes |
| --- | ------------ | ------- | ----------- | ------- | ----- | ------ | ----- | --------- |
| 1×  | 65–72        | 118–128 | 92–100      | 59–65   | 11–12 | 8–9    | 18–19 | 2,719     |
| 4×  | 314–415      | 512–630 | 413–534     | 255–347 | 53–66 | 41–43  | 71–83 | 2,719     |

With the idle trace's share subtracted, style, layout, and paint together take 30 ms at 1×
and 130–160 ms at 4×. The page has 1,395 `td` elements and 769 inputs and buttons.

The CPU profile (`Profiler.start`, 100 µs samples, 5 runs, source-mapped) attributes each
sample to the nearest app frame on its stack, in milliseconds per open. The profile adds
up to 20% overhead and counts forced style and layout as script.

| Where the time goes                                                           | 1×   | 4×   |
| ----------------------------------------------------------------------------- | ---- | ---- |
| Style and layout forced by `document.fonts.ready` in `PageTitle`              | 13.3 | 59.8 |
| Solid's `cleanNode` disposing the timer page the click left                   | 10.1 | 46.6 |
| Timesheet: `Cell`, `Pick`, the `For`s, and reading `perBucket` from the store | 8.1  | 44.7 |
| Timesheet: `TableCell`, `TableHead`, `TableRow` (`splitProps`, `spread`)      | 7.5  | 35.0 |
| Timesheet: `today()` through `localDate` and `Intl.formatToParts`             | 6.2  | 30.8 |
| Timesheet: `Duration`                                                         | 1.2  | 5.8  |
| Garbage collection                                                            | 3.2  | 28.1 |
| Reports view, filter bar, and Entries card                                    | 3.7  | 20.0 |
| Router, query, page title, scene, and the rest                                | 15.8 | 68.4 |
| Playwright's own locator queries (the harness)                                | 8.1  | 39.8 |
| Total sampled                                                                 | 77.2 | 379  |

- The grid's script is 23 ms at 1× (117 ms at 4×), and no one function dominates it.
- `today()` in `reports-view.tsx` is a plain function passed as `today={today()}`, so each
  `props.today` read in the timesheet's `current(bucket)` calls `localDate(Date.now())`,
  once per cell and header: about 1,300 `Intl.formatToParts` calls for one date.
- `TableCell` and `TableHead` run `splitProps`, `mergeProps`, and `spread` for each of the
  1,300 cells and headers. `spread` makes a render effect per cell.
- `cn` and tailwind-merge take 0.6 ms in total: tailwind-merge caches repeated class
  strings. `Duration`'s `Show` and `For` take 1.2 ms.
- `Pick` makes a `createSelector` subscription per button for `aria-pressed` (1.4 ms).
  `Cell` reads `cell.ms` three times, each through the store proxy.
- After the forced recalc, the timesheet's `ResizeObserver` sets `data-more`. The rule
  `.timesheet:not([data-more]) :is(th, td):last-child` (`src/styles.css`) then makes Chrome
  restyle every `th` and `td`: a second recalc of 1,472 elements, 3.0 ms at 1×.
- Reading `document.fonts.ready` in `PageTitle`'s `onMount` runs the new page's style
  recalc (2,613 elements, 5.7 ms) and layout (6.9 ms) inside the click's task. It is the
  page's normal style and layout run early, not extra work.
- The measured path starts on the timer, so 10 ms is the timer page's teardown. Making the
  timer lighter (task 057) reduces it.
- At 1440 × 900, 13 of the grid's 41 rows and 21 of its 32 columns show.
- Shared with the timer (task 057): the forced style and layout in `PageTitle`, `Intl` calls
  from unmemoized derived functions, and the `ui/table.tsx` wrappers, which the timer's
  Table layout uses (2.7 ms at 1× there).
