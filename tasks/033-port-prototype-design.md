# 033: Port the prototype design to the app

Status: in-progress

Tasks 029, 031, and 032 changed the prototypes' look after task 023 ported the views: brand
colors and font, the app icon, the Appearance popover, the seasonal scene with its weather,
glass surfaces, the tagline, and the intro. Bring that design into the Solid app. The views
themselves (task 023) stay as they are. This task is about the look and the scene around them.
The prototypes' design is settled; port it as `prototypes/README.md` describes it, and change
the README first if the app needs something different.

Work in this order, one commit or more per step, and check each in the dev app at 1440, 850, and
390 px, light and dark (`docs/skills/ui-review/SKILL.md`):

1. **Tokens and brand**: the colors and font from "Brand font and colors" in
   `prototypes/README.md` in `src/styles.css`, and the app icon and favicon ("App icon"), with
   the chosen icon as a user setting.
2. **Appearance popover and settings**: the header's Appearance popover (theme, app icon,
   scenery) and Settings > Preferences > Scenery, on the user settings `sceneSeason`,
   `sceneBackground`, `sceneStrength`, `surfaces`, `sceneWeather`, and `sceneIntro` in
   `user_settings`. Read `docs/migrations.md` before touching the schema. Signed out, the sign-in
   page keeps them on the device. The Appearance button uses Lucide's `mountain-snow` icon, the sign-in
   page's Scenery icon, so one icon opens the scenery everywhere.
3. **Scene**: the background images (`design/backgrounds/`, 1920 and 3840 px WebP picked for the
   screen), the tint, and glass or solid surfaces behind every signed-in page and the sign-in
   page. Popovers and dialogs stay solid.
4. **Weather**: the WebGL effects from `prototypes/scene.js`, calm on app pages, off with reduced
   motion and in hidden tabs. Check the frame time with a running timer.
5. **Tagline and seasonal copy**: `prototypes/seasons.js` as Paraglide messages, the tagline in
   the title row, and the sign-in page's tagline above the card.
6. **Intro**: `prototypes/intro.js` on the sign-in page (first visit) and the signed-in pages
   (once a season, Replay intro), after task 032's subtask 01.

## Progress

- 2026-09-25: Step 1a: `src/styles.css` has the brand tokens, the UI font is Plus Jakarta Sans
  from `@fontsource-variable/plus-jakarta-sans`, and times and durations use it with
  `tabular-nums` instead of `font-mono`. `html` has the background color and the signed-in frame
  the `bg-muted/40` tint. Checked at 1440, 850, and 390 px, light and dark.
- 2026-09-25: Step 1b: the brand's project colors are in `--series-1` to `--series-8` and
  `PROJECT_COLORS`, with the prototype's names (Blue, Terracotta, Teal, Ochre, Rose, Moss, Indigo,
  Brick). A data-only migration moves each stored palette hex to the new color in its slot.
- 2026-09-25: Step 1c: the app icon is the `appIcon` user setting (`app_icon`, `'01'` to `'12'`,
  default `'02'`). The header and the sign-in card show the bare mark for the page's theme, the
  favicon follows the setting, and Settings > Preferences > Appearance opens the app icon dialog
  from Change. The sign-in card shows Hound Hour until step 2. The Appearance popover's Change
  comes in step 2. Checked at 1440, 850, and 390 px, light and dark: keyboard use, focus return,
  the favicon following a change, and the dialog fitting 390 × 844.
- 2026-09-25: Step 2a: the scene settings are `user_settings` columns: `scene_season` (`'auto'`,
  or a season), `scene_background`, `scene_strength` (`'dimmed'` or `'full'`), `surfaces`
  (`'glass'` or `'solid'`), `scene_weather`, and `scene_intro`, with the prototype's defaults.
  The session and `updateSettings` carry them. Nothing shows or uses them yet.
- 2026-09-25: Step 2b: the header's Appearance popover (`mountain-snow` button left of the
  avatar) holds the theme, the app icon with Change, the scenery (`src/components/scenery-fields.tsx`,
  shared with Settings and the sign-in page), and All settings. Theme left the user menu and the
  timer's View popover. `AppIconDialog` moved to `src/components/`. The scenery controls save,
  but nothing acts on them yet: Season, Background, Strength, and Surfaces wait for step 3, and
  Weather for step 4, whose hint gives only the season's effect or reduced motion until then
  (no WebGL reasons yet). Replay intro comes with step 6. Escape now closes the popovers when
  focus is on a toggle: Kobalte's toggle group took Escape to clear its selection and blocked the
  dismiss, in the View popover too. Checked at 1440, 850, and 390 px, light and dark: saves survive
  a reload, Strength and Surfaces disable with Background off, Change opens the dialog with focus
  on the chosen icon and Escape returns it to the Appearance button, and no horizontal scroll.
- 2026-09-25: Step 2c: Settings > Preferences > Scenery (`#scenery`) has the scene controls with
  the prototype's hints and the Intro switch, each saved on its own. "Replay it" comes with step 6. Checked at 1440, 850, and 390 px, light and dark: saves show Saved, survive a reload, and
  show in the Appearance popover.
- 2026-09-25: Step 2d: signed-out pages keep the theme, the app icon, and the scene settings on
  the device (`snowtime.settings`, `src/lib/device-settings.ts`, each field checked and every
  storage access guarded). Their Appearance menu (the mountain button, top right) adds Theme above
  the scenery, since signed out the theme had no control; `docs/architecture.md` and the README
  record the change. The head script applies the device's theme before the first paint, and the
  sign-in card and favicon show the chosen icon once the page hydrates. Signed in, the root copies
  the account's values to the device; at sign-in the account's settings apply. Checked at 1440,
  850, and 390 px, light and dark: settings survive a reload, the device theme wins over the
  system's, broken or invalid storage falls back to the defaults, and no horizontal scroll.
- 2026-09-25: Step 3a: the season images are in `public/backgrounds/` (1920 and 3840 px WebP),
  and `SceneLayer` (`src/components/scene-layer.tsx`) puts them behind the signed-in frame and the
  sign-in page: light and dark crossfade with the theme, the tint follows Strength, and with
  Background off the page shows the plain `bg-muted/40` tint as before. `photoWidth` in
  `src/lib/scene.ts` picks the file. The frames carry `data-scene-bg` and `data-surfaces` instead
  of the body, so the server renders them and portaled popovers and dialogs sit outside them.
  Checked with the background files throttled to 1.6 Mbps: at 1440 × 900 and 850 × 900 at 2×,
  the shown theme's 1920 and 3840 files load together and the other theme's 1920 file only after
  the 3840 one decodes; at 1× and at 390 × 844 at 3×, only 1920 files; with Background off,
  none. Season, Strength, and Background changes in the Appearance popover show at once. Checked at
  1440, 850, and 390 px, light and dark, on every signed-in page and the sign-in page: no
  horizontal scroll and no browser errors.
- 2026-09-25: Step 3b: over the image, cards and card-like elements (`surface`: the timer bar,
  the entry table, the empty states, the team cards, the sign-in card) are glass (`card` at 70%
  with a 24 px blur) or solid, both with a soft shadow; the sign-in card keeps the prototype's
  larger one. Solid-UI's `Card` got the `surface` class. The header is the page color at 82% with
  a 16 px blur, or solid with solid surfaces. Dialogs and popovers stay solid, since they render
  outside the frame. Checked at 1440, 850, and 390 px, light and dark, glass and solid, on every
  signed-in page and the sign-in page: no horizontal scroll and no browser errors.
- 2026-09-25: Step 3c: over the image, page titles, subtitles (`scene-text`), and page-level
  notes (`page-note`, centered: the footnotes under Projects' and Members' cards and the timer
  list's end lines) get the page-color glow, the notes and subtitles a color between
  `muted-foreground` and `foreground`, and outline buttons a page-colored fill (Solid-UI's
  `Button` now renders `data-variant`). The sign-in page's tagline is `scene-text` until step 5
  replaces it. The timer's "Show earlier entries" is an outline button instead of a ghost one,
  since it was hard to see on the light images; it isn't in the prototypes. Reports' timesheet
  marks itself `data-scrolled` while scrolled sideways, and on glass its sticky column is
  see-through until then. The app has no midnight note on Reports, so there's nothing to style.
  Checked at 1440, 850, and 390 px, light and dark: no horizontal scroll and no browser errors.
- 2026-09-25: Step 3d: the signed-in header is sticky at every width (both rows below 768 px),
  so the navigation stays in reach down a long entry list; the prototypes' header scrolls away,
  and `prototypes/README.md` records the difference. Checked scrolled at 1440 and 390 px, light and
  dark: the cards scroll under the header's blur, and the organization menu opens above it.
- 2026-09-25: Step 3 is done; `docs/architecture.md` records the scene's assets, loading, and
  surfaces ("Seasonal scene"). Still waiting: the weather and the Weather hint's WebGL reasons
  (step 4; the Weather switch saves but shows nothing yet), the season's tagline in the title row
  and above the sign-in card (step 5; the sign-in page keeps its old line until then), and the
  intro with Replay intro and "Replay it" (step 6).
- 2026-09-25: Step 4 plan: the effects' shaders and the renderer from `prototypes/scene.js` go
  in `src/lib/weather.ts` (one WebGL 2 context, one draw call per frame, about 45 fps, point
  counts by area). `SceneLayer` gets the canvas and a `pace` prop: calm (half the points, 70%
  speed) from `AppFrame`, full from `AuthLayout`. It runs only with the Weather switch on, no
  reduced motion, and a visible tab, and colors follow the theme and whether the image shows. It
  publishes why the weather can't run (no WebGL 2, or the effect failed to compile) in a signal
  that `SceneryFields`' Weather hint reads, beside reduced motion. On unmount it cancels the frame
  and loses the context. Check: frame times as Mia with a running timer at 1440 × 900 at 2×, and
  that frames stop in a hidden tab.
- 2026-09-25: Step 4: the weather is in (`src/lib/weather.ts`, the canvas in `SceneLayer`),
  calm on app pages and at full pace on the sign-in page. Its colors follow the theme and
  whether the image shows, and it stops with the Weather switch off, with reduced motion, and in
  a hidden tab. The Weather hint and switch say why it's off: reduced motion, no WebGL 2, or an
  effect that didn't compile, which is also logged as a console warning. Unmounting cancels the
  frame and loses the context. Checked: all four effects in light and dark, over the image and on
  the plain page, compile and draw. As Mia, with a running timer and the weather on at 1440 × 900
  at 2× in headless Chrome, frames held 16.7 ms (p95 16.8 ms), the same as with the weather off;
  the timer's entry was deleted afterwards. Hidden tab: Playwright and agent-browser keep pages
  visible even headed, so it was checked by faking `document.hidden` and `visibilitychange`: no
  draws while hidden, and it restarts when shown. The no-WebGL 2 and failed-effect hints were
  checked with WebGL stubbed out. Checked at 1440, 850, and 390 px, light and dark, on every
  signed-in page and the sign-in page: no horizontal scroll and no browser errors. The dev app
  sometimes takes 10 to 30 s to hydrate a page; before then, there's no image or weather.

## Acceptance criteria

- [ ] Each step above is in the app and matches its prototype in light and dark
- [ ] The scene settings are user settings, with a migration, and apply without a reload
- [ ] Reduced motion keeps the weather and the intro off
- [ ] No horizontal scroll at 390 px and no browser errors on any view
- [ ] `docs/architecture.md` records the scene (assets, WebGL, settings), and `prototypes/README.md`
      notes that the design is ported
