# 05: Background image quality

Status: todo

The eight backgrounds in `design/backgrounds/` are 1672 × 941 px, so they turn soft when stretched
over large screens. Upscale them, add detail where the images are thin, and serve a sharper file
only where it shows.

## Acceptance criteria

- [ ] Each image is upscaled to at least 3840 px wide with an AI upscaler, and detail is added
      where it's thin (distant ridges, trees, snow texture) without changing the composition or
      the light. The light and dark versions of a season still line up, so the theme crossfade
      doesn't shift.
- [ ] The source PNGs stay as the originals. The upscaled masters and the tool and settings used
      are recorded in `design/backgrounds/`.
- [ ] The pages load WebP (or AVIF) sizes that fit the screen, for example 1920 and 3840 px
      wide, picked by viewport width and pixel ratio. Small screens don't download the large
      file.
- [ ] The larger image loads during the intro, which opens on the weather alone (subtask 02), so
      it's ready when the background fades in. Without the intro, the smaller image shows
      first and the sharper one replaces it without a visible jump.
- [ ] File sizes and load times are checked on a throttled connection, and recorded in
      `prototypes/README.md`.
