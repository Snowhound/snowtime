# Snowtime brand asset draft

Open [review.html](review.html) to inspect the 12 icons, small variants, lockups,
and browser-tab previews. Concept `02` is the default. Every concept is traced
from `input/early-exploration.png`, because hand-drawn versions lost the
concepts' shapes and shading.

[trace_board.py](trace_board.py) handles `01` and `03`–`12`. It crops each large
mark from its board tile, separates it from the tile background, and writes to
`source/` a potrace outline, the mark's own shading upscaled 8x as WebP, and
its bounds. [build.py](build.py) clips that shading to the outline and sets it
on a navy or ice tile, so the icons keep the board's gradients and facets with
clean edges. The SVGs therefore embed raster shading.

[hound_hour.py](hound_hour.py) draws `02` from
`source/02-hound-hour-trace.txt`, a potrace trace of the 02 tile on
`input/early-exploration.png` (mask in `source/02-hound-hour-mask.png`). The clock
arc, hands, and tick are geometry fitted to that mask. The gradients and faceted
shading follow the board: white on dark and slate blue on light.

| No. | Motif             | Filename stem          |
| --- | ----------------- | ---------------------- |
| 01  | Frost Clock       | `01-frost-clock`       |
| 02  | Hound Hour        | `02-hound-hour`        |
| 03  | Peak Time         | `03-peak-time`         |
| 04  | Progress Flurry   | `04-progress-flurry`   |
| 05  | Snow S Monogram   | `05-snow-s-monogram`   |
| 06  | Crystal Time      | `06-crystal-time`      |
| 07  | Tracking Together | `07-tracking-together` |
| 08  | New Day           | `08-new-day`           |
| 09  | ST Monogram       | `09-st-monogram`       |
| 10  | North Star        | `10-north-star`        |
| 11  | The Trail         | `11-the-trail`         |
| 12  | Snow Crystal      | `12-snow-crystal`      |

## Contents

- `icons/`: normal icon SVGs, shown at 128 px.
- `icons-small/`: favicon sources. The mark fills more of the tile, and `02`
  also drops its facets and thickens its hands.
- `02-hound-hour-light` in `icons/`, `icons-small/`, `favicon/variants/`, `qa/`,
  and `png/`: 02's light-theme mark on the ice tile the light concepts use.
  The prototypes show it on light pages.
- `lockups/`: mark and outlined `Snowtime` wordmark SVGs. Light-tile concepts
  use the bare mark with navy text. Navy-tile concepts use the tile with navy
  text, plus a `-dark` lockup with the bare mark and white text for dark pages.
- `source/`: traced outlines, shading, bounds, and masks for every concept.
- `marks/`: the bare `02` mark for light and dark backgrounds.
- `png/`: 1024 px app icons for every concept, plus `02` marks and 4x lockups.
- `wordmark.svg`: `Snowtime` in Plus Jakarta Sans Bold with -0.02 em tracking,
  outlined by [wordmark.py](wordmark.py). It needs no font at runtime. The font
  and its SIL OFL 1.1 license are in `fonts/`.
- `favicon/`: default `02` SVG, 16, 32, 180, 192, and 512 px PNGs; `variants/`
  contains 16 and 32 px PNGs for all concepts.
- `site.webmanifest`: proposed standalone-app manifest with default `02` artwork.
- `theme-tokens.css`: proposed light/dark brand tokens.
- `qa/`: extra 20, 24, and 64 px PNGs used for size checks.

The supplied single board contains both the full icons and miniature favicon
previews. No separate later browser-tab board was available. Small icons reuse
the traced art, zoomed in; like the board's own previews, the pale light-tile
concepts read faintly at 16 px. The palette was read
approximately from the board, then adjusted for readable text and controls.
It is **not** a claim about exact Snowhound brand hex values. The existing app
uses neutral semantic tokens, so these brand tokens have not been applied to it.

The board lettering is not a known font. Plus Jakarta Sans Bold was the closest
match among 20 geometric sans candidates compared against it. These are draft
assets for visual approval before prototype or app integration.

## Rebuild

Run `trace_board.py` only when the board crops change; it needs numpy, scipy,
pillow, and `brew install potrace`. Run `python3 design/brand-assets/build.py` for SVGs and the review page, then
`python3 design/brand-assets/export-png.py` for PNGs. The export script renders
with headless Chrome, because this system's ImageMagick SVG renderer omits
strokes, and then resizes with ImageMagick. The checked-in `render.png` is the
intermediate export sheet. Run `wordmark.py` only when the wordmark changes; it
needs `pip install fonttools uharfbuzz`.

Changing a page's favicon can happen immediately when a user selects an icon.
An already installed PWA home-screen icon may remain unchanged even if the
web manifest later points to another concept.

## Browser QA

Checked in Chrome on 2026-09-24. Every icon, small icon, lockup, and 16 and 32 px
favicon was rendered next to its board tile and compared by eye; `02` was also
compared with the asset board's hero lockup and app icons. `build.py` parses
every SVG it writes. The review page sets `favicon/favicon.svg` as its real tab
icon. The tab strips in the sheet are visual previews. The prototypes' icon picker
and favicon switching are in `prototypes/app-icon.js` (task 029).

The light `02` mark's facet lines are an approximation: the board shows the
light version only on the asset board, and its facets were not traced.
