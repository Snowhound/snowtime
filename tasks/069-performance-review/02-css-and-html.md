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

## Acceptance criteria

- [ ] Tailwind scans only the app's sources, and the CSS size change is recorded
- [ ] CSS and HTML sizes per page before and after, from the harness
- [ ] Each render-cost candidate measured or ruled out, with the reason
- [ ] No visible change, checked by Kait on the pages the changes touch
