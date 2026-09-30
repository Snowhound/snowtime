# 05: Weather under the glass

Status: done

On the timer and reports pages, glass surfaces (`.surface`, `backdrop-filter: blur(24px)`)
can cover most of the screen. No effect shows through them usefully: under a 70% card color
and a 24 px blur, a flake is a faint smudge. Yet the canvas still draws there, and every
weather frame makes the browser blur each surface again, since the canvas under it changed.
Task 063 measured that blur as the main GPU cost of the weather.

The browser can't skip either on its own. A WebGL canvas marks its whole area as changed on
every frame, so the compositor re-blurs everything over it; and the canvas doesn't know
where the cards are.

## Options to compare in the weather bench

Measure each with the harness's layouts (sign-in card, timer, mostly covered reports), then
pick one.

1. **Cull under the surfaces.** The renderer gets the surfaces' rectangles, inset by the blur
   radius, from a `ResizeObserver` and the scroll offset (no layout reads in the frame). The
   vertex shader moves points inside a rectangle off-screen; quads (rain, mist) clip with the
   scissor or a rectangle test. Saves fill, but the re-blur remains. Small and local.
2. **Glass that doesn't read the canvas.** The surfaces show a pre-blurred copy of the photo
   instead of a live backdrop blur: a small, blurred image of the same picture, aligned with
   the scene. With that, the weather under a card is hidden and can be culled as in option 1,
   and nothing re-blurs per frame. The hard part is keeping the copy aligned while the page
   scrolls: `background-attachment: fixed` repaints on scroll in Chrome and is ignored on iOS,
   so the likely route is a second fixed layer of the blurred photo above the canvas, clipped
   to the surfaces.
3. **Canvas above the content.** Put the weather canvas over the page (`pointer-events: none`)
   with the surfaces cut out of it, so the glass blurs only the still photo and re-blurs only
   on scroll. The cutouts must follow scrolling within the same frame, or items bleed over a
   card's edge while it moves; a soft fade at the edges may hide that. Weather would also fall
   over text outside cards, such as page titles. Kait is open to it only if it helps a lot:
   some effects would hide small details outside cards, for example fog over the markers at
   the end of a list. If the numbers make it the clear winner, build it so Kait can check the
   worst cases (thickest fog, busiest rain) and look for workarounds there.
4. **A smaller blur.** Measure 24 against 16 and 8 px. The cost grows with the radius. This
   is a design change, so Kait decides.

Also measure the simplest fallback: fewer weather frames while surfaces cover most of the
screen.

## Acceptance criteria

- [x] GPU and compositor time for each option on the three layouts, at 60 and 120 Hz,
      against today's (weather bench, trace summary). At 120 Hz, only today's glass against
      the chosen copy, on the timer layout
- [x] The chosen option in the app, with the numbers and the reason in
      `docs/architecture.md` ("Seasonal scene", "Glass")
- [x] Nothing looks different except where Kait agreed to it, checked by Kait while
      scrolling on the timer and reports pages, in both themes, in Chrome and Safari
- [x] Popovers, menus, and dialogs unaffected (they're solid and render outside the frame;
      none holds a `Glass` element)

## Pop-ins when the collection changes (fixed)

Kait saw two on 2026-09-30 in Chrome, switching collections with the September pictures.
Between the two Baltic collections, the mist under the cards appeared twice and much more
strongly than production's live blur. Switching to Mountain valley, the background crossfaded,
then flickered to something else a second or two later.

Both had the same cause. A backdrop filter makes its element the containing block for fixed
descendants. So while the copy faded in or out over the live blur (`over` and `under`), its
`position: fixed` layer covered only the surface: each card showed the whole blurred photo
shrunk to its own size. At `on`, the surface dropped its blur and the copy snapped into line
with the screen. In the dark Baltic coast picture, the shrunk copy's bright fog read as a
second, stronger mist.

The fix: in every `data-glass` state the surface has no backdrop filter itself. During the fades,
the live blur and the surface's color sit in the surface's `::before`, under the copy.

Checked in Chrome, dark theme, logging each state change and a card's mean color every
~35 ms:

- Each switch runs one fade cycle (`on`, `under`, cleared, `over`, `on`). The top photo
  changes once, and `weatherImage` doesn't switch twice.
- The card's color follows the photo's crossfade and settles, with no jump at `on`.
- `over` matches `on`, and `under` matches no `data-glass`, except for antialiasing on a few
  rounded corners (weather off, screenshots compared pixel by pixel). The isolation and
  `position: relative` change nothing.

Kait checked the fix in the app on 2026-09-30: better in Chrome (dark theme), and correct in
Safari in the light theme, switching collections and themes and scrolling.

## Findings (2026-09-30)

Weather bench on Kait's M1 Pro, headless Chrome (60 Hz), 1440 × 900, pixel ratio 1.5, calm
pace, with the photo. Each option ran as a bench variant, interleaved with today's glass in
3-second windows. "Proc" is the GPU process's CPU time in ms per second, all threads, from
CDP's `SystemInfo.getProcessInfo`; it holds the display compositor and, under SwiftShader,
the drawing itself. "GPU" is the GPU's utilization from `ioreg`, system-wide and noisy, so
only large gaps count.

Timer layout, squall (rain, 60 fps):

| Variant                                    | Viz | GPU main | Proc | GPU % |
| ------------------------------------------ | --: | -------: | ---: | ----: |
| Today's live blur                          |  39 |       91 |  175 |    21 |
| 1. Cull items under the surfaces           |  35 |       86 |  164 |    19 |
| 2. Pre-blurred copy (cards and header)     |  19 |       33 |   92 |     0 |
| 2. Copy for the cards, header blurs live   |  27 |       57 |  126 |       |
| 2. Same, canvas clipped below the header   |  23 |       46 |  106 |       |
| 3. Canvas above the page, surfaces cut out |  37 |       85 |  164 |    21 |
| 4. Blur 16 px                              |  37 |       92 |  170 |    21 |
| 4. Blur 8 px                               |  34 |       82 |  161 |    21 |
| Half the frame rate                        |  21 |       42 |   91 |    11 |
| No glass surfaces at all                   |  12 |       25 |   66 |     0 |

- Options 1, 3, and 4 stay within the noise. Chrome redraws the page's frame on every canvas
  frame, and with it every live backdrop blur on the screen, whatever lies under it.
- The copy removes the blurs, so every effect falls to near the no-glass floor on each
  layout. Full run, `live` against the copy, on all 25 cases: proc per second 154 to 81
  (squall), 81 to 49 (snow), 43 to 34 (mist) on the timer layout; 128 to 87 on reports and
  121 to 70 on sign-in for the squall.
- SwiftShader, the weak-GPU proxy: the live blur saturates the GPU process, and 60 fps
  effects draw 12 to 16 fps, 30 fps ones 14 to 16. With the copy they draw 50 to 57 and 28
  to 30.
- At 120 Hz (2026-09-30, headed on the M1 Pro's ProMotion screen, Chrome at 120 rAF per
  second, timer layout, pixel ratio 2), the copy saves as much as at 60 Hz. The weather keeps
  its own rate, so only the compositor runs faster:

  | Case, live → copy   | fps | Viz     | GPU main            | Proc                |
  | ------------------- | --: | ------- | ------------------- | ------------------- |
  | Squall              |  60 | 47 → 27 | 132 → 40            | 241 → 144           |
  | Snow                |  30 | 28 → 13 | 60 → 15             | 122 → 60            |
  | Mist (four presets) |  10 | 12 → 10 | 20 → 7 (one run 37) | 67–90, within noise |

- The header alone is about a third of the glass's cost. Kait chose to copy it too, so the
  page scrolling under it no longer shows through its 82% page color.
- A CSS `filter: blur(24px)` on each surface's copy cost about the same as the pre-blurred
  image in Chrome, but a filter per surface depends on the browser caching it, so the copy
  is blurred once in JavaScript.

## Checked and left as is

- Culling the weather under the surfaces: no measurable gain, even under SwiftShader on the
  mostly covered reports layout (copy with and without culling within noise). The canvas's
  own draw is small next to compositing, so the renderer takes no surface rectangles.
- Canvas above the page (option 3): no gain, since the surfaces still blur live, and it would
  hide details outside the cards.
- A smaller blur (option 4): 8 px saves about 8%, not worth the design change.
- Fewer frames under covered screens: half the rate halves the cost, but the copy saves more
  with no change to the motion.
- The sign-in page's Appearance button keeps its small live blur (`backdrop-blur`); it's not
  a surface.

## Notes

- `content-visibility: auto` on the timer's day cards pinned each card's copy to the card,
  so the photo repeated in every card. The containment moved to a wrapper inside the card.
- The weather bench now shows the copy by default; `--variant=live` gives the live blur, and
  its paced half prints `proc` and `use %` columns. Timing always draws the photo, which the
  copy needs.
- Page baselines grow by one `.glass` element per surface (2 to 7 DOM nodes a page), CSS
  by 233 gzipped bytes, and route JS by about 500 bytes; the blur itself loads lazily.
