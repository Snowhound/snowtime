# 10: Report timesheet HTML and hydration

Status: done

The report timesheet (`src/features/reports/timesheet.tsx`) is most of the Reports page's
HTML. On main 2e1f669 (2026-09-30), the 2025-10-01 to 2026-09-30 custom range is 925 KB
raw / 46.8 KB gzip (the harness, at gzip level 9, counts 46,544 bytes), of which the
`<table>` is 807 KB / 22.5 KB. That grid is 26 rows × 54 weekly buckets, about 1,400 cells
of about 750 bytes each: a `td` and a `button` with two `data-hk` keys of about 118
characters, a 330-byte class list, `data-row`, `data-bucket`, and `aria-describedby`.
This subtask tries two ways to send less of it.

## How it was measured

Builds, all made in the main checkout:

- A: main 2e1f669.
- B: change 1, leaner server-rendered cells.
- D: change 2 alone, the grid body rendered only in the browser.
- C: changes 1 and 2 together.

`perf:pages --audit` ran A, D, C, B, A, D, C, B, each build served with the new `--build`
option. Every byte and DOM count repeated exactly in both passes. The 12-month page comes
from `--audit` and has no budget. Timings in the tables are medians of 8 loads per page and
build, with all four builds served at once and the order alternating on each load (a scratch
script with the harness's probe, 4× CPU slowdown). The two full-harness passes agree with
them. Single harness runs of one build vary by up to ±200 ms in hydration, so the tables
show medians.

The harness gained a "grid ms" column: the first animation frame with a timesheet cell
button in the DOM. For server HTML, that's while the parser inserts the table. For a
client-rendered body, it's after hydration.

## Change 1: leaner cells (kept)

- The pick buttons' 330-byte class list is one `pick` class, and a cell's is one
  `timesheet-cell` class. Both are `@apply` rules in `src/styles.css`, in the components
  layer, so utilities passed beside them still win. `PICK_CLASS` is gone; Summary's and
  Breakdown's `PickButton` use the same class.
- The cell's button is written out in `Cell` rather than rendered through `Pick`, so the
  `td` and its button are one template with one hydration key instead of two.
- `data-row` sits on the `<tr>`. The delegated click handler takes the bucket from the
  cell's column (`cellIndex - 1` into the report's buckets). The first and last columns
  give no bucket, and the totals row has no `data-row`. That drops `data-pick`, `data-row`,
  and `data-bucket` from every button.
- `type`, `aria-pressed`, and `aria-describedby` stay on every button, so keyboard and
  screen-reader behaviour is unchanged.

| Page      | HTML raw, A → B   | HTML gzip, A → B         | DOM nodes | Hydrate ms, A → B | Grid ms, A → B | Long tasks (n / ms), A → B |
| --------- | ----------------- | ------------------------ | --------- | ----------------- | -------------- | -------------------------- |
| Week      | 175,242 → 146,608 | 18,243 → 17,689 (-3.0%)  | 596       | 555 → 526         | 172 → 173      | 3 / 411 → 3 / 399          |
| Year      | 718,644 → 384,489 | 36,896 → 30,553 (-17.2%) | 2,154     | 888 → 857         | 284 → 252      | 3 / 491 → 3 / 510          |
| 12 months | 924,992 → 488,131 | 46,544 → 34,907 (-25.0%) | 2,802     | 983 → 898         | 307 → 282      | 3 / 547 → 3 / 523          |

Timings show no consistent change. An earlier 8-load A/B pass had 12 months at 851 → 778 ms
and the year at 754 → 802 ms. The bytes are the gain, and the change also removes code.
The rules cost 125 bytes of gzipped CSS (17,548 → 17,673). That is `.pick`'s own rules for
its variants; the utilities that only the pick buttons used are no longer emitted. The
reports route's JS went from 227,883 to 227,832 gzipped bytes.

SSR parts of the 12-month page, raw bytes: markup 561,830 → 221,404, hydration markers
307,870 → 211,435, and class attributes 365,177 → 90,752. Query data stays 47,984.

With builds A and B in Chrome, computed styles match: padding, margins, colors, radius,
alignment, and numerals of the first row's and totals row's cells and buttons, at rest, after
a cell is pressed, and on the next focused button. Screenshots are pixel-identical in both
themes. A test now also covers the row-total button, which the new bucket lookup reaches as
the last column.

## Change 2: grid body only in the browser (dropped)

The grid is built only from data the page already dehydrates. The route's loader fetches
`getReport` and the projects, teams, and members lists, and `reportRows` names the rows from
them; today's bucket comes from the browser's clock. The trial wrapped the body rows in
TanStack's `ClientOnly`, with a placeholder row of the grid's height: 37 px per row, plus
36.5 px for the totals row, which held at 1440 px and 390 px. The header stays
server-rendered and keeps the columns. The columns do narrow before the body mounts
(12 months: 3,600 → 3,693 px; week at 390 px: 661 → 692 px), but only inside the table's
scroller, so the card doesn't move.

| Page      | HTML gzip, A / B / D / C          | Hydrate ms, A / B / D / C | Grid ms, A / B / D / C | Long tasks ms, A / B / D / C |
| --------- | --------------------------------- | ------------------------- | ---------------------- | ---------------------------- |
| Week      | 18,243 / 17,689 / 15,631 / 15,630 | 555 / 526 / 514 / 541     | 172 / 173 / 571 / 609  | 411 / 399 / 339 / 388        |
| Year      | 36,896 / 30,553 / 22,399 / 22,398 | 888 / 857 / 668 / 629     | 284 / 252 / 798 / 745  | 491 / 510 / 472 / 417        |
| 12 months | 46,544 / 34,907 / 24,782 / 24,781 | 983 / 898 / 670 / 727     | 307 / 282 / 822 / 896  | 547 / 523 / 520 / 475        |

Raw HTML with change 2 is 102,367 (week), 137,059 (year), and 150,123 bytes (12 months),
with or without change 1. DOM counts are unchanged. Hydration finishes 170 to 310 ms sooner
on long ranges, but only because the body is no longer part of it. The grid then renders
after hydration: it first appears 400 to 610 ms later than from server HTML on every range.
The page is done, the later of hydration and grid, at about the same time: C against B is
609 against 526 ms on the week, 745 against 857 on the year, and 896 against 898 on 12
months. The two full-harness passes repeat this: grid 177 to 439 ms for A and B, 586 to
988 ms for C and D.

On top of change 1, change 2 saves 2 KB (week), 8 KB (year), and 10 KB (12 months) of
gzipped HTML, and at most about 110 ms of time to a finished page. That doesn't pay for
showing the page's main content half a second later, or for an empty grid until the
JavaScript runs. Limiting it to long ranges doesn't help: they save the most bytes but also
wait longest for the grid (12 months: 282 → 896 ms). Dropped for every range.

## Checked and left as is

- `aria-describedby` on every button: it points each button to the pick hint, and there is
  no per-table equivalent. A shorter ID would save about 14 KB raw on 12 months and nothing
  noticeable gzipped.
- `type="button"`: 20 KB raw on 12 months, near nothing gzipped. It keeps the buttons safe
  if the grid ever sits in a form.
- The remaining hydration keys: one per cell, about 100 characters, 211 KB raw on 12 months.
  Solid 1.x keys grow with component depth. Shortening them would mean flattening the
  component tree above the table, which reads worse. No hydration gain was measured from
  halving them.

## Acceptance criteria

- [x] Both changes measured alone and together, in two alternating A/B passes whose counts
      repeat
- [x] Raw and gzip HTML, hydration, long tasks, DOM nodes, and grid time recorded for the
      week, year, and 12-month pages
- [x] Change 1 kept and change 2 dropped, each with its numbers
- [x] Page and bundle baselines updated with the change
- [x] Kait has checked the timesheet visually: week and 12 months, both themes, narrow and
      desktop, selecting cells and rows (2026-09-30)
