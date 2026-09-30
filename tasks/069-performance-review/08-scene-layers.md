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
- The weather when the page is idle or on battery: whether it should draw less after some
  time without input. A product question for Kait before any code.

## Acceptance criteria

- [ ] GPU memory and layer count, from Chrome's Layers panel or a trace, on the timer page
      before and after a theme switch
- [ ] Changes made where layers or images stay around without being seen
- [ ] Kait's answer on idle and battery behavior recorded, and done if wanted
