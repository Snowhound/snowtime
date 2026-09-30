# 05: Weather under the glass

Status: todo

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
   over text outside cards, such as page titles, which Kait decides on.
4. **A smaller blur.** Measure 24 against 16 and 8 px. The cost grows with the radius. This
   is a design change, so Kait decides.

Also measure the simplest fallback: fewer weather frames while surfaces cover most of the
screen.

## Acceptance criteria

- [ ] GPU and compositor time for each option on the three layouts, at 60 and 120 Hz,
      against today's (weather bench, trace summary)
- [ ] The chosen option in the app, with the numbers and the reason in
      `docs/architecture.md` ("Weather")
- [ ] Nothing looks different except where Kait agreed to it, checked by Kait while
      scrolling on the timer and reports pages, in both themes, in Chrome and Safari
- [ ] Popovers, menus, and dialogs unaffected (they're solid and render outside the frame)
