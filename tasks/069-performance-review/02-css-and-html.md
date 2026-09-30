# 02: CSS and HTML

Status: todo

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

## Acceptance criteria

- [x] Tailwind scans only the app's sources, and the CSS size change is recorded
- [ ] CSS and HTML sizes per page before and after, from the harness
- [ ] Each render-cost candidate measured or ruled out, with the reason
- [ ] No visible change, checked by Kait on the pages the changes touch
