# 05: Background image quality

Status: done

The eight backgrounds in `design/backgrounds/` are 1672 × 941 px, so they turn soft when stretched
over large screens. Upscale them and serve a sharper file only where it shows.

## Acceptance criteria

- [x] Each image is upscaled to at least 3840 px wide with an AI upscaler without changing the
      composition or the light. The light and dark versions of a season still line up, so the
      theme crossfade doesn't shift. Adding detail with a generative upscaler was dropped: it
      redrew small shapes and wasn't worth the cost (`design/backgrounds/README.md`).
- [x] The source PNGs stay as the originals. They and the upscaled masters stay local, and the
      tool and settings used are recorded in `design/backgrounds/README.md`.
- [x] The pages load WebP (or AVIF) sizes that fit the screen, for example 1920 and 3840 px
      wide, picked by viewport width and pixel ratio. Small screens don't download the large
      file.
- [x] The larger image loads during the intro, which opens on the weather alone (subtask 02), so
      it's ready when the background fades in. Without the intro, the smaller image shows
      first and the sharper one replaces it without a visible jump.
- [x] File sizes and load times are checked on a throttled connection, and recorded in
      `prototypes/README.md`.
