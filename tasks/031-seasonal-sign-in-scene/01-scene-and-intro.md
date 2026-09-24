# 01: Scene, intro, and settings

Status: done

Port the mock-up's WebGL snow and intro to `auth.html`, with the seasonal images, and let users
turn the parts off.

## Acceptance criteria

- [x] `auth.html` shows the season's image behind the card layout and in the split layout's
      brand panel, with the mock-up's WebGL snow in winter (`prototypes/scene.js`). The pages
      load WebP copies of the images.
- [x] Snow is white in dark mode and over the light image, and blue-grey on the plain light page.
- [x] The intro plays on the first visit by default, can be skipped with a button or Escape,
      and can be replayed. Reduced motion skips it and turns the snow off.
- [x] Users can turn the background, the weather, and the first-visit intro off, and choose the
      background's strength (full or dimmed), in the sign-in page's Scenery menu and in
      Settings. The choices are shared settings.
- [x] An app-wide Surfaces setting chooses glass or solid cards.
- [x] The prototype bar compares seasons, tagline treatments, and page tone.
