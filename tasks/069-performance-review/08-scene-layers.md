# 08: Scene layers

Status: todo

What sits under the weather also costs memory and fill: the photos, their crossfades, and
the tint. A 3840 × 2168 image takes about 33 MB of GPU memory once decoded, and a crossfade
between themes or images holds two or more at once. On a weak laptop that competes with
the weather and the glass.

## Candidates to check

- Which file each screen loads: the 3840-wide image only where the screen needs it (width
  times pixel ratio above 1920), and the small one replaced, not kept, once the sharp one
  shows.
- How many photo layers stay in the page after a crossfade, and whether the old one is
  removed from the DOM or only hidden.
- The tint and any other full-screen overlays: one layer, or several that each add a
  full-screen blend. Merge into one where the result is the same.
- Decoding off the main thread (`decode()` or `decoding="async"`), so a new image doesn't
  cause a long task.
- The weather when the page is idle: Kait agreed it may draw less after some time without
  input. Battery is still open.
- Slowing the weather while the page scrolls, at least the fog: Kait's idea, to use with
  care, since a change of rate mid-scroll may show as a stutter or a jump. Try it in the
  weather bench and show Kait before it goes in the app.

## Acceptance criteria

- [ ] GPU memory and layer count, from Chrome's Layers panel or a trace, on the timer page
      before and after a theme switch
- [ ] Changes made where layers or images stay around without being seen
- [ ] The weather draws less after a time without input, and picks up again smoothly on
      input
- [ ] Slowing down while scrolling tried in the bench, and kept only if Kait finds no
      artifacts
