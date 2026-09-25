# 01: Font and colors

Status: done

Apply the brand font and the light and dark palette to every prototype through the shared
`prototype.css` and `prototype-theme.js`, so no page needs its own brand styles.

The font is Plus Jakarta Sans (SIL OFL 1.1), the match for the board's wordmark
(`design/brand-assets/README.md`). Load the variable font in
`design/brand-assets/fonts/` with `@font-face` in `prototype.css`, the same file the
wordmark was outlined from. Chrome loads it over `file://` from the parent folder.

The palette comes from the asset board. `design/brand-assets/theme-tokens.css` holds only
part of it; the board's swatches are:

| Mode  | Colors                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------- |
| Light | navy `#0f1f2e`, slate blue `#3b82b8`, icy blue `#7fb3e6`, pale blue `#d7ecfc`, ice `#f4faff`   |
| Dark  | background `#0b1622`, surface `#1e2f45`, accent `#4f7fb9`, highlight `#a7d0fb`, text `#e6f4ff` |

These are approximate readings of a generated image, not Snowhound brand values.

## Acceptance criteria

- [x] Every prototype uses Plus Jakarta Sans for UI text. The `font-family` stack keeps a
      system fallback.
- [x] Timer durations and table numbers stay aligned. Check that `tabular-nums` works in
      the new font, and decide whether the `font-mono` elapsed time and duration cells
      keep a monospace font.
- [x] Every semantic token in `prototype.css` (`background`, `card`, `popover`,
      `primary`, `secondary`, `muted`, `accent`, `border`, `input`, `ring`, and their
      foregrounds) has a light and a dark value derived from the palette. `destructive`
      stays red. Component variants stay unchanged.
- [x] Text pairs meet WCAG AA 4.5:1, including `muted-foreground` on `background`,
      `card`, and `muted`. Input borders and the focus ring meet 3:1. A table in
      `prototypes/README.md` records each adjusted color and its ratio.
- [x] The eight `--series-*` project and chart colors are checked again with the dataviz
      checks against the new light and dark surfaces. Change only the slots that fail.
      `project.color` stores the light hex, so a changed slot needs its fixture colors in
      `app-data.js` updated too. Charts keep their labels and table views.
      All eight passed; on review they moved to cooler brand steps of the same hue families,
      and light `primary` moved from navy to `#2f6797` (`prototypes/README.md`).
- [x] Every prototype page (auth, timer, projects, reports, settings, organization) is
      checked in light and dark mode at 1440, 850, and 390 px: readable controls, visible
      focus, no overflow, and no browser errors. Compare axe color-contrast results with
      the ones the README records today.
