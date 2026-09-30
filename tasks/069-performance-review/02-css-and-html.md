# 02: CSS and HTML

Status: in-progress

Less CSS and HTML sent, and less work to style and paint it, without making the markup
harder to read.

## Candidates to check

Tailwind output:

- `src/styles.css` imports `tailwindcss` with no `source()`, so Tailwind v4 scans the whole
  project except what `.gitignore` excludes: `prototypes/`, `docs/`, `tasks/`, and
  `design/`. Classes that only the prototypes or the docs use may end up in the app's CSS.
  Limit the scan to `src/` and compare the output.
- `tw-animate-css`: how much of it the app uses. Import only those parts if it's large.
- Classes and theme variables no component uses any more, for example after the prototype
  port.
- Arbitrary values (`text-[11px]`, `-top-[3px]`) that match a theme step.

Render cost:

- `backdrop-filter` surfaces: how many render at once per page, and whether any nest (glass
  inside glass), since each is its own render pass. Subtask 05 handles their cost over the
  weather.
- `transition-all` (2 uses) and transitions on layout properties, which make the browser
  check every property on every change. Name the properties.
- Large `box-shadow` on many elements at once, such as rows, and `will-change` left on
  after an animation.
- `cn()` calls `twMerge` on every render. Check its cost in lists with many rows (timer
  entries, timesheet cells, report tables); where the classes are static or can't conflict,
  plain `class` or `clsx` is simpler as well as faster.

HTML:

- The SSR HTML of `/timer` and `/reports` for a year, by part: markup, the dehydrated query
  data, and hydration markers. If the query data is the largest part, check whether the page
  sends data it doesn't render on first view, or sends it twice.
- Long class lists repeated in every row of a table. Gzip hides most of the repetition over
  the wire, so this matters only if parse or hydration time shows it.
- Inline SVG icons repeated per row. A sprite with `<use>` would cut bytes but reads worse;
  change only if the numbers are large.

## Outcome

Tailwind scan:

- `src/styles.css` now imports `tailwindcss` with `source('./')`, relative to the file, so
  Tailwind scans only `src/`. Gzipped CSS went from 18,931 to 17,862 bytes (-1,069, -5.6%),
  raw CSS from 94,669 to 87,261 bytes. Both page numbers repeated across two runs.
- What dropped out was used only by `prototypes/`, `docs/`, `tasks/`, or `design/`:
  `-left-1`, `-mb-2`, `-mt-2`, `-mt-4`, `-mt-10`, `-top-[3px]`, `accent-foreground`,
  `accent-primary`, `backdrop-filter`, `bg-background/70`, `bg-card/70`, `bg-muted/40`,
  `border-border`, `border-destructive`, `border-l-[3px]`, `bottom-4`, `contents`,
  `ease-in-out`, `gap-0`, `grid-cols-[auto_1fr]`, `grow`, `h-0.5`, `h-2`, `h-40`,
  `inset-x-0`, `left-4`, `max-h-28`, `max-h-[calc(100dvh-16px)]`, `max-w-[380px]`,
  `max-w-[calc(100vw-2rem)]`, `mb-8`, `min-w-[44rem]`, `min-w-[52rem]`, `p-8`, `pb-5`,
  `pr-3`, `pt-4`, `pt-16`, `ring`, `ring-offset-1`, `ring-offset-2`, `ring-ring`, `shadow`,
  `shadow-xl`, `slide-in-from-left-1/2`, `slide-in-from-top-[48%]`, `space-y-2`,
  `space-y-3`, `table-caption`, `table-cell`, `table-row`, `text-wrap`, `text-xl`, `top-6`,
  `transform`, `w-12`, `w-[300px]`, `w-[340px]`, `zoom-out`, `[field-sizing:content]`,
  `backdrop:bg-background/80`, `checked:*`, `sm:-mt-16`, `sm:flex`, and a few
  `sm:`/`lg:`/`max-md:` variants.
- Nothing the app uses went missing. The names that still appear in `src/` are in `@apply`
  lines (which inline the utility), in comments, or in JS with the same letters
  (`!running`); `perf/weather/bench.ts` uses only the app's own classes (`.surface`,
  `.scene-header`, `.scene-weather`), and its 75 golden frames still match.

Transitions:

- `transition-all` is gone. `TabsTrigger` (`src/components/ui/tabs.tsx`) animates colors and
  the selected tab's shadow and focus ring, so it's now
  `transition-[color,background-color,box-shadow]`, as `switch.tsx` does. `TabsIndicator`
  animates Kobalte's inline `transform`, `width`, and `height`, so it's now
  `transition-[transform,width,height]`; nothing renders it today.
- Transitions on layout properties: none in `src/`. `TabsIndicator`'s `width` and `height`
  are the only ones, and it is unused. The CSS transitions in `src/styles.css` are
  opacity, transform, and filter (the intro lines and page).
- Kait checked the tabs on Organization, Projects, and Reports after these changes
  (2026-09-30): no visible change.

Remaining CSS and HTML review (2026-09-30):

- Removed the five unused `--chart-*` tokens and eight unused `--sidebar*` tokens,
  their dark values, and their `@theme` aliases. No component, inline style, or script
  references them. Reports and project colors use `--series-*`, which stay.
- Changed the header's `max-w-[13rem]` and `max-w-[16rem]` to `max-w-52` and
  `max-w-64`. Both keep their widths, 13rem and 16rem, with the app's spacing theme.
- Added `bun run perf:pages --audit`: exclusive SSR byte counts, SVG and class-attribute
  subsets, computed glass filters and nesting, shadow values, row shadows, and
  `will-change`. `--scene --audit` checks glass with the image on. A separate audit page
  covers 2025-10-01 through 2026-09-30: the harness's gated "year" is January through
  September, not twelve months. This extra page has no budget.

The old and new builds alternated A, B, A, B in the same session. Two runs of each build
repeated these scene-off counts. CSS is the sum of loaded stylesheets: 87,305 → 86,313
raw bytes and 17,862 → 17,548 gzipped bytes (-314, -1.8%). The CSS bundle and
page budgets are tightened to 17,548 bytes. Rebased on subtask 04, the baselines were
rewritten from the main checkout: JS chunks moved by 1 to 9 gzipped bytes, including
routes this change doesn't touch, as their hashed import names changed.

| Page                                | HTML raw, before → after | HTML gzip, before → after | CSS gzip, before → after | DOM nodes |
| ----------------------------------- | ------------------------ | ------------------------- | ------------------------ | --------- |
| Reports, week                       | 175,252 → 175,242        | 18,240 → 18,235           | 17,862 → 17,548          | 596       |
| Reports, harness year               | 718,654 → 718,644        | 36,895 → 36,890           | 17,862 → 17,548          | 2,154     |
| Reports, twelve months (audit only) | 925,002 → 924,992        | 46,545 → 46,535           | 17,862 → 17,548          | 2,802     |
| Settings                            | 141,364 → 141,354        | 16,222 → 16,219           | 17,862 → 17,548          | 562       |
| Sign-in                             | 25,621 → 25,621          | 6,569 → 6,572             | 17,862 → 17,548          | 156       |
| Timer                               | 265,039 → 265,029        | 18,217 → 18,213           | 17,862 → 17,548          | 1,195     |

The shorter header classes remove ten raw bytes on signed-in pages. Sign-in's three
extra compressed bytes come from changed asset names in the document; its raw size is
unchanged. No DOM count changes. Hydration shows no consistent improvement: Timer's two
pairs are 719 → 669 ms and 670 → 677 ms; the harness year is 1,010 → 1,010 ms and
953 → 1,089 ms. These are reported timings at 4× CPU slowdown, not new budgets.

SSR parts are raw UTF-8 bytes after nonce and timestamp normalization. Markup excludes
scripts, `data-hk` attributes, and HTML comments. Query bytes are the serialized
`dehydratedData` value, including its stream setup; shared data defined in router state
stays in other scripts. Script tags and their own hydration attributes also stay there.
The four columns add up to the document; SVG and classes below are subsets of markup.

| Page                   | Markup, before → after | Query state | Hydration markers | Other scripts |
| ---------------------- | ---------------------- | ----------- | ----------------- | ------------- |
| Timer                  | 166,143 → 166,133      | 25,036      | 66,414            | 7,446         |
| Reports, harness year  | 436,742 → 436,732      | 42,640      | 231,964           | 7,308         |
| Reports, twelve months | 561,840 → 561,830      | 47,984      | 307,870           | 7,308         |

## Checked and left as is

- `tw-animate-css`: Dialog, Popover, and Select use enter/exit, opacity 0, and scale 95
  utilities. DropdownMenu uses the app's own content-show/hide keyframes. The emitted
  animation rules, enter/exit keyframes, and 17 property registrations total 3,234 raw
  bytes; removing that text offline saves 464 gzipped bytes in the old stylesheet.
  Registrations alone cost 1,229 raw / 115 marginal gzipped bytes. Accordion and other
  unused keyframes are absent. Version 1.4.0 exports only the full and prefixed stylesheets,
  so importing parts would mean maintaining local copies. Kept the supported import.
- Unused classes: the custom scene, intro, tagline, and calendar classes have callers,
  including computed names and classes added by scripts. Unused registry exports still
  contribute classes, such as TabsIndicator's 2px dimensions; the UI registry copies
  intentionally retain those exports. Kept that convention rather than pruning components
  for a few rules. The UI README also names two old, unprefixed animation classes;
  they emit 269 raw bytes (11 marginal gzipped bytes). Kept the precise recorded
  class names rather than changing the completed scan configuration. `@theme` drops unused
  aliases, such as `--color-series-*`, from emitted CSS already; kept those source aliases. Runtime `--series-*` values are used dynamically.
- Arbitrary values: replaced the two header widths that reuse spacing steps. Kept 10px,
  11px, and 13px text, -3px offsets, 2px tab indicators, and the textarea's 80px minimum:
  they are fixed pixel sizes, unlike rem-based steps when the browser's default font size
  changes. Kept calculated grids, viewport bounds, percentages, and the custom 68rem/88rem
  page limits. They express layout constraints rather than an existing named theme size.
- Glass surfaces in the seeded desktop pages, after hydration, with scene and glass on:

  | Page                             | Backdrop filters | Nested filters | Surfaces                          |
  | -------------------------------- | ---------------- | -------------- | --------------------------------- |
  | Timer                            | 7                | 0              | Header, timer bar, five day cards |
  | Reports, week/year/twelve months | 3                | 0              | Header, timesheet, Entries card   |
  | Settings                         | 3                | 0              | Header, profile, preferences      |
  | Sign-in                          | 3                | 0              | Theme button, auth card, footer   |

  Counts include laid-out offscreen elements; they are not counts of GPU passes in view.
  With the scene off, signed-in pages have zero filters; Sign-in keeps its three.
  Popovers, menus, and dialogs render outside the glass frame and stay solid. The header
  retains its filter even with solid surfaces; subtask 05 handles blur cost over weather.

- Large shadows: no `li`, `tr`, `td`, or `th` has a shadow in any measured page. Scene
  shadows belong to cards, not every entry or timesheet cell (30px blur; auth card 25px
  and 10px). Settings has 68 shadow-bearing elements, including small switch thumbs,
  scenery thumbnails, and rings. Timer has 59, including transparent Tailwind shadow
  placeholders on controls. The audit prints computed shadow values to distinguish them.
- `will-change`: zero on the settled pages. The only source declaration is
  `.intro-line`'s transform/filter hint, retained to prevent Firefox's documented text
  jump after the transition. The intro overlay unmounts when it ends (12,950 ms normally,
  1,100 ms after Skip), so the hint does not remain on the page. Kept it.
- `cn()`/`twMerge`: checked representative timer-row, timesheet-cell, timesheet-pick,
  and report-summary class lists. Eight alternating batches of 250,000 calls compare
  `twMerge(clsx(inputs))` with `clsx(inputs)` under Bun. After the first two warm-up
  batches, medians are 0.0785 µs/call versus 0.021 µs/call. These few repeated combinations
  hit twMerge's existing cache. Even 2,600 calls add about 0.15 ms of merge overhead in
  this microbenchmark. Kept the readable calls and override contracts in shared table
  components; this is not a browser hydration profile or a promise about another machine.
- Query data: the full twelve-month report's envelope is about 5% of its HTML; markup
  and hydration keys dominate. Entries load only in the browser, and Breakdown loads
  only in that view, so neither sends an unrendered list on first load. Seroval references
  shared objects (`$R[...]`), including the session shared by route context and query state.
  No duplicate report payload was found. Kept the hydration contract.
- Repeated classes: Timer has 98,911 raw class-attribute bytes; the harness year has
  279,229. Removing every class attribute offline saves only 3,907 / 4,532 gzipped bytes,
  an upper bound that removes styling entirely. No parse or hydration gain from extracting
  row classes was measured, so kept the strings local rather than adding a second source for their styling.
- SVG: Timer has 32,305 raw SVG bytes; the harness year has 8,100. Removing every SVG
  offline saves 2,886 / 1,501 gzipped bytes, an upper bound that also removes page-level
  controls. Kept inline icons; a sprite would still need accessible per-use markup and
  would make the component copies harder to read.

## Acceptance criteria

- [x] Tailwind scans only the app's sources, and the CSS size change is recorded
- [x] CSS and HTML sizes per page before and after, from the harness
- [x] Each render-cost candidate measured or ruled out, with the reason
- [ ] No visible change, checked by Kait on the pages the changes touch

## Open for review

- Kait: check the signed-in header's organization and user names on Timer, Reports,
  Settings, Projects, and Organization, at narrow and desktop widths and in both themes.
  The two width classes are equivalent with the current spacing theme; no visible change
  is intended. The visual acceptance criterion stays open until Kait checks them.
- The query-byte split measures the serialized envelope, not each query's independent
  compressed contribution. Shared references cross that boundary; review this definition
  before using it to justify a data-shaping change.
- The `cn()` result is a Bun microbenchmark. A browser CPU profile of a very large custom
  report could test cache misses and signal updates if list rendering becomes a bottleneck.
- Surface counts cover the harness's seeded desktop pages with menus closed. Other Timer
  layouts, Reports tabs, narrow viewports, open overlays, and transient intro layers need
  separate render-cost checks. Subtask 05 owns the GPU cost of blur over weather.
- No sprite, hydration-key rewrite, or extraction of repeated row classes was attempted.
  No visible design change was made; this subtask remains in-progress for follow-up review.
