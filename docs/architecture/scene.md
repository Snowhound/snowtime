# Seasonal scene

The signed-in pages and the sign-in page show a landscape from the user's collection behind the
page, as `prototypes/README.md` describes in "Seasonal scene in the app" and "Scenery
collections".

- Collections (task 062; ids in `src/lib/scene/images.ts`, labels and lookups in
  `src/lib/scene/scene.ts`): the background comes from a collection and follows the calendar
  within it. Mountain valley (`mountains`, the default) holds the four season images, `winter`
  to `autumn`. Baltic countryside (`countryside`) and Baltic coast (`coast`), in that order in
  the pickers, hold one image per month, `land-january` to `land-december` and `coast-january`
  to `coast-december`. Each collection's files are in a folder of its own, and the image id
  names them: `/backgrounds/<collection>/<id>-<theme>-<version>-<width>.avif`. One folder per
  collection keeps each set together as the collections grow. The version
  is two digits, `02` unless `PHOTO_VERSIONS` in `scene.ts` lists the image at `01`: `public/`
  files are cached for a week, so a replaced image needs a new name (task 065).
- Setting: `scene_collection` and `scene_pin`, an image id in the collection or null to follow
  the calendar. The older `scene_season` column is unread and stays until a later migration
  drops it; the device's settings still read an old `sceneSeason` as Mountain valley, pinned
  to that season or, for `auto`, unpinned. A collection has
  one pin: the server clears it when the collection changes and refuses a pin from another
  collection. `imageFor` picks the pin or the calendar's image; the month lookup takes an
  optional zone, which the callers don't pass yet (task 050).
- Pickers: Settings > Preferences > Scenery shows the three collections as radio cards, each
  with all its images, and saves a choice at once, so the scene behind the page is the
  preview. The pin is a second radio group behind a "Pin an image" disclosure. The Appearance
  popover shows the collection and image with a link to that section, and the sign-in page's
  menu has a Collection select, since there's no Settings page signed out.
- Season copy: the tagline, `SeasonProvider`, and the intro's lines follow the season of the
  image that shows, so their colors are the ones checked on it. The intro still plays once a
  calendar season (`MONTH_SEASONS` in the head script), and fades in the image that shows.
- Thumbnails: the pickers show up to 28 images at once, so `thumbUrl` returns a 400 px file
  of each, 2 to 15 KB, instead of the 1920 one. A test checks that every id has its six files.
- Assets: each image has a light and a dark file in `public/backgrounds/<collection>/`, 400,
  1920, and 3840 px wide, as AVIF only (`design/backgrounds/README.md` records how they're
  made). Every supported browser decodes AVIF; one that doesn't, such as Edge before 121,
  fails the load and shows the page color behind the scene. There's no WebP set: it would
  double the committed files for no supported browser (task 051). The
  files are 67 to 758 KB each (the leafy Baltic scenes are the largest), so they're files
  rather than bundled imports, and nothing loads until the page asks for one.
- Loading (`src/components/scene/scene-layer.tsx`, `photoWidth` in `src/lib/scene/scene.ts`):
  the 3840 file is for images that cover more than 2400 device pixels across (pixel ratio at
  most 2), and screens under 768 px always get the 1920 file. The shown theme loads the 1920
  file first, on its own so it arrives sooner, fades it in once it has decoded, then loads the
  larger one and swaps to it. The other theme's 1920 file loads after that, for the theme
  crossfade, but only once a switch is likely (`expectThemeSwitch`): the Appearance button is
  hovered or focused, or Settings opens. That saves about 200 KB on a visit that doesn't
  switch; a switch without it, such as a `system` theme turning dark, fades the new picture in
  once it has decoded (task 073). Nothing loads while Background is off. The browser loads the
  images after hydration, since only it knows the screen and a `system` theme, so they don't
  compete with the scripts. The files in `public/` are cached for a week (`routeRules` in
  `vite.config.ts`), so a changed image needs a new name.
- Settings: the layer reads the session's settings, or the device's when signed out (see "User
  settings"), so a change shows without a reload.
- Surfaces: the frame around the page carries `data-scene-bg` and `data-surfaces`, which the
  server renders, and `src/styles.css` styles `surface` elements, the header, and the text over
  the image from them. It also carries the tint's strength, which the scene and the glass
  share. Popovers, menus, and dialogs render into `<body>`, outside the frame, so they stay
  solid.
- Glass (task 069): a glass surface shows a copy of the photo that the browser blurred once,
  not a live `backdrop-filter` blur. Every weather frame changes the whole canvas, so the
  browser redrew each live blur on every frame, which cost more than the weather itself.
  - The scene layer blurs the photo that shows with `glassPhoto` (`src/lib/scene/glass.ts`),
    loaded when a picture first shows: a 240 px wide copy, a Gaussian blur in JavaScript with
    the standard deviation `blur(24px)` has on this screen, as a JPEG data URL. The content
    security policy allows `data:` images but not `blob:`. The canvas `filter` property could
    do the blur, but its Safari support wasn't confirmed, and the JavaScript blur (a few
    milliseconds, once per image and theme) gives the same result in every browser.
  - Each `surface` and the header holds a `Glass` element (`src/components/scene/glass.tsx`).
    Once the copy is ready, the frame gets `data-glass` and `--glass-photo`, and the `.glass`
    layer shows the page color, vignette, tint, and copy under the surface's border. The layer
    is `position: fixed`, as the scene is, inside an element clipped to the surface, so the
    copy stays aligned while the page scrolls, and the compositor moves it with the scroll.
    The surface keeps its border, radius, and shadow.
  - Paint containment, a transform, or a filter on an ancestor makes the layer fixed to that
    ancestor instead of the screen, which shows as the photo repeating in each card. The
    timer's day cards keep `content-visibility: auto` on a wrapper inside the card for this
    reason.
  - A backdrop filter on the surface itself does the same, so while the copy fades, the live
    blur sits in the surface's `::before`, under the copy, and the surface has none.
  - The copy fades in over the live blur, which stops once the copy covers it. Before a new
    picture or theme fades in, the copy fades out over the live blur again, then back in
    after the picture's fade, so the weather and mist under the surfaces don't pop in or out.
    `data-glass` goes `under`, `over`, `on`.
  - What differs from a live blur: the weather under a surface and the page scrolling under
    the header don't show through. Kait agreed to both; the header alone is about a third
    of the glass's cost.
  - A surface without the `Glass` element, or any surface before the copy is ready, blurs
    live.
  - Gain: the copy takes 35 to 55% off the GPU process's time on the timer, reports, and
    sign-in pages at 60 Hz; the squall on the timer page drops from 154 to 81 ms a second,
    near the 66 ms with no glass at all. At 120 Hz the squall drops by 40% and snow by half.
    On a weak GPU (SwiftShader), 60 fps effects draw 50 to 57 fps instead of 12 to 16.
    Culling the weather under the surfaces, the canvas above the page, and a smaller blur each
    saved little. Task 069, subtask 05 has the measurements.
- Tint (`STRENGTHS` in `src/lib/scene/scene.ts`, `.scene-tint` in `src/styles.css`): a
  vertical gradient of the page color over the image keeps the text readable, covering
  `strength × 70%` at the top and `strength × 115%` at the bottom. Dimmed, the default, is 0.4
  light and 0.55 dark; Full is 0.2 and 0.3. A stronger light tint turned bright scenes very
  white, and Kait chose a lighter tint over regenerating the images (task 065).
- Weather (`src/lib/scene/weather.ts`, task 066): `IMAGE_WEATHER` gives each image its horizon
  and zones, and a preset for light and dark pages (or one for both), by name, with the fields it
  changes; `weatherFor` merges the preset, then the image's horizon, zones, and fields. Task 066
  records which image gets which and why, and `prototypes/weather.html` shows them. A preset
  holds only values two or more images share, so the app's presets and table differ from the
  prototype's, though each image resolves to the same weather (task 073).
  - Colors are data: each effect has two colors for dark pages, light pages over the image, and
    the plain light page, and a preset or an image can replace them for any of the three.
  - Presets tune one of eight effects: snow (and flurries, blowing snow, sea spray), rain
    (squalls), seeds (fine seeds, motes, dust), fireflies, leaves, glitter
    (snow and frost), insects (midges, with fireflies at night), and mist. The `none` preset has
    no effect, for an image that should be still; no image uses it now.
  - Wind: every effect takes a wind in screen heights per second, gusts, and shear, so snow,
    rain, seeds, leaves, and midges in one image blow the same way, as the reeds, grass, and
    waves lean. Shear strengthens the wind below the image's horizon, so falling snow and rain
    arc toward the side near the ground. Rain's slant is the wind against its fall there and
    then. The mountain images take a steady wind, with no gusts or shear.
  - Tuning: factors of each effect's amount, size, fall, and opacity, and fields for glitter's
    shimmer and glints and the midges' groups, go to the shaders as uniforms.
  - Parts of the image: each Baltic image's horizon, the band that mist, spray, and midges
    keep to, and zones (up to three rectangles: where glitter lies, so it misses water, where
    midges and fireflies keep, and where mist lies) are fractions of the image. The renderer
    maps them to the screen the way `cover` and `background-position: center 20%` crop the
    photo, so they stay on the ice or the water on any screen. A recomposed image changes only
    these numbers.
  - The Weather hints name the showing image's preset (`scene_effect_*`), or "still air". The
    weather follows the picture on screen, so a new image switches both as it starts to fade in.
- Weather rendering (`src/lib/scene/weather-renderer.ts`): `SceneLayer` loads the renderer
  when enabled weather first needs it, after mount. Presets and settings hints stay in
  `weather.ts`, so pages with weather off send no shaders (task 069). Explicit SSR guards
  keep the renderer and the browser's XLSX export library out of the server build.
  Each effect is a WebGL 2 program that draws all its points (rain's and
  the mist's quads) in one call with no buffers, on one canvas in the scene layer, with item
  counts scaled to the screen's area. The band, horizon, zones, count, and the uniforms that
  follow from them, and the colors, are worked out on a start or a resize; a frame uploads only
  the time. The canvas has at most 1.5 backing pixels per CSS pixel, and the mist, which is soft
  and the costliest per pixel, 0.5. Its WebGL context starts the first time it runs. App pages
  run it calm (half the points, 70% speed), and the sign-in page at full pace. It runs only with
  the Weather switch on, without reduced motion, and in a visible tab. Without WebGL 2, or when
  an effect's shaders don't compile, it stays off and the Weather hint says why. Unmounting
  cancels the frame and loses the context.
  - A program compiles for the features its weather uses, as `#define`s (`BAND`, `SHEAR`,
    `ZONES`, `GATHER`, `FLUFF`, `FIREFLIES`), so it has no branches or uniforms for the rest.
    Each variant compiles lazily, the first time a picture needs it (task 069, subtask 06).
  - An item's color and other values that stay the same across its pixels come from the
    vertex shader. Points take them as `flat` varyings. Quads (rain, mist) keep them smooth,
    because `flat` on triangles made ANGLE on Metal draw rain about 10% slower.
  - The fragment shaders are `mediump`. The mist's noise hashes its lattice cells with
    integers and takes its coordinate in `highp`, because a `sin` hash and a `mediump`
    fraction break down there. The mist writes zero where it's too faint to show instead of
    discarding, which was up to a quarter faster on the Apple M1.
  - Mist without zones keeps to the ground below the horizon, as glitter does; a mist preset's
    `band` has no effect. The prototype does the same, so this is the look Kait approved.
  - Glitter's glint cycle comes from the amount and the glints wanted on a 1440 × 900 screen,
    not the point count, so a resize doesn't jump every speck to another point of its cycle.
- Weather frame rate: each effect sets a target, and a preset can set its own. Blowing snow,
  spray, rain (so the squalls), leaves, and the midges run at 60 fps, since they move far
  enough per frame that 30 looks steppy on fast screens. The mist barely moves, so it runs at
  10: its fastest bank moves about 3 px a frame on a 900 px screen, under its soft edges. The
  rest run at 30, since each frame's cost in the display compositor scales with the rate
  (task 063). The renderer
  draws every nth display refresh, with n from the refresh rate it measures from its first
  frame gaps, so frames are evenly spaced: rain draws 60, 45, 60, 72, and 60 fps at 60, 90,
  120, 144, and 240 Hz. A millisecond threshold can't do this; 22 ms gives 30 fps at 60 Hz and
  gaps alternating between two and three refreshes at 90 Hz. When frame gaps show dropped
  frames, each frame waits one refresh more, down to about 30 fps. Speed comes from the frame
  timestamps, so it doesn't depend on the rate.
- Tagline: [taglines.md](taglines.md).
- Intro (`src/lib/scene/intro.ts`, `src/components/scene/intro.tsx`): module-level signals
  hold its state, so the frames, the scene layer, and the Replay buttons share one player. The
  page under it stays mounted, hidden and `inert`. While it plays, `<html data-intro>` holds
  the page dark: the theme script in `<head>` treats it as dark and applies the saved theme
  once it goes. When the intro is due, the same script sets `data-intro="pending"`, which
  paints the page black before hydration. It decides from the device's settings, since the
  account's aren't loaded yet; the frame clears it if the account's Intro switch is off, and a
  timeout clears it if nothing mounts.
- Storage keys in `localStorage`: `snowtime.settings` (the device's settings; see "User
  settings"), `snowtime.introSeen` (the sign-in page's intro has played in this browser), and
  `snowtime.introSeason` (the calendar season the intro last played in, so app pages play it
  once a season), and `snowtime.taglineSeen` (the page tagline's text when it last showed, so
  a new one gets its cue). Every access is guarded; blocked storage only means the intro may
  play again, or a new tagline shows without its cue.
