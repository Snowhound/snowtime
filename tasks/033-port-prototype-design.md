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
- 2026-09-25: Step 5 plan: `prototypes/seasons.js`' lines, alternates, sign-offs, and period
  taglines become Paraglide messages (`season_<season>_line_<n>`, `season_<season>_alt_<n>_line_<n>`,
  `intro_sign_off`, `intro_sign_off_signed_in`, `tagline_week_end_<n>`, `tagline_month_end_<n>`),
  and `src/lib/seasons.ts` holds them with each season's colors, `introLines`, and `PERIODS`
  (not shown yet, as in the prototypes). `SeasonTagline` (`src/components/`) renders the two-toned
  line; `PageTitle` puts it in each page's title row and places it from 1024 px as `app-frame.js`
  does, on resize (a `ResizeObserver` on the title area), once fonts load, and when the season
  changes. The season comes from the frame through a context, so views and their tests don't
  need the session. The sign-in page's line under the card becomes the tagline above the card.
  `auth_tagline` goes.
- 2026-09-25: Step 5: the seasonal copy is in Paraglide messages and `src/lib/seasons.ts`, with
  the colors, `introLines`, the alternates, and `PERIODS` (the last two not shown yet). Each
  page's title is `PageTitle` (`src/components/page-title.tsx`), with the two-toned
  `SeasonTagline`: centered on the title row from 1024 px unless it would come within 24 px of
  the title or the actions, and under the title otherwise, placed again on resize, once fonts
  load, and when the season changes. The frame gives it the season through `SeasonProvider`, and
  the test setup stubs `ResizeObserver`, which jsdom lacks. On the sign-in page the tagline
  replaced the line under the card and sits 32 px above it, out of the flow; on phones the page's
  top padding grew from 64 to 128 px to make room. Over the image it gets the title's glow.
  Checked at 1440, 1100, 1024, 850, and 390 px, light and dark, on every signed-in page and the
  sign-in page: centered from 1024 px, under the title below it, and a Season change in the
  Appearance popover swaps and re-centers it; no horizontal scroll and no browser errors. In a
  long agent-browser session, the first page after a viewport change sometimes stalls for 10 to
  40 s before it hydrates; in Playwright it hydrates within 400 ms every time, so the stall comes
  from the tool, not the app.
  Estonian lines to review (I'm unsure of these):
  - Spring: "Nagu ka mälestus möödunud nädalast." (So is your memory of last week.)
  - Summer: "Sinu ajatabel ei pea olema." (Your timesheet doesn't have to be.) The English plays
    on "long"; the Estonian may need "nii pikk" to read as intended.
  - Autumn: "Kuu lõpp läheneb samuti." (So is the end of the month.) This one doesn't echo
    "falling".
  - Autumn alternates: "Nagu ka sinu kirja panemata tunnid." and "Ööd pikenevad. / Tähtaeg
    läheneb." (The nights are drawing in. / So is the deadline.)
  - Periods: "Tähtaeg samuti." (So is the deadline) and "Sinu tunnid ei tohiks puududa." (Your
    hours shouldn't be [out].)
  - Sign-offs: "Logi sisse ja tee ära!" and "Oled sees. Tee ära!"
- 2026-09-25: Step 6 plan: `src/lib/intro.ts` holds the intro's state and timeline from
  `prototypes/intro.js` (signals the frames and the scene layer read), `introDue` (the sign-in
  page on the first visit, `snowtime.introSeen`; app pages once per calendar season,
  `snowtime.introSeason`; both under the Intro switch and never with reduced motion), and
  `playIntro`/`skipIntro`. While it plays, `<html data-intro>` keeps the page dark (the theme
  script treats it as dark and releases the theme when it goes), the scene shows the weather and
  the intro's background whatever the switches say, and the dark sharp image preloads.
  `src/components/intro.tsx` has the overlay (portaled to `<body>`, so the frames' outline-button
  fill doesn't reach Skip) and `IntroPage`, the wrapper each frame puts around its page: hidden,
  `inert`, and rising into place at the end, but always mounted. Skip and Escape end it; focus
  returns to the Appearance button or the Replay link. The head script sets `data-intro="pending"`
  (black page, hidden body) when the intro is due on this path by the device's settings, and the
  frame clears it if the account's settings say otherwise; a timeout clears it too, in case
  nothing mounts. Replay intro goes in both Appearance menus and "Replay it" in Settings'
  Intro hint, disabled with reduced motion. The flush that applies the start's cut reads the
  scene's photo layers' opacity instead of the body's, subtask 01's fix for Firefox.
- 2026-09-25: Step 6: the intro is in (`src/lib/intro.ts`, `src/components/intro.tsx`). It plays on
  the sign-in page on the first visit and on the first signed-in page of a calendar season, ends
  with "You're in. Get it done!" signed in, and can be replayed from both Appearance menus
  (Replay intro) and from Settings > Scenery ("Replay it"), all disabled with reduced motion. The
  frames wrap their page in `IntroPage`, and `AuthLayout` moved `isolate` and the scene
  attributes to an outer wrapper for it. The head script paints the page black when the intro
  is due. Checked in Chrome through Playwright:
  - First visit in a light system theme: the first paint is black (`data-intro="pending"`), then
    the weather alone, the lines at their cues, the background from 3.1 s, and the page rising in
    the light theme at 13.3 s. `snowtime.introSeen` and `snowtime.introSeason` are then set, and
    a reload doesn't play it.
  - As Mia with `snowtime.introSeason` at another season: it played on the timer, and Escape
    stored the month's season. A running timer kept counting under a replay (0:00:01 before,
    0:00:05 during, 0:00:07 after); the entry was deleted afterwards.
  - Focus: on Skip while it plays; after Replay intro, on the Appearance button; after "Replay
    it", on the link; after the intro on its own, on the body. Reduced motion: no intro, and Replay
    is disabled.
  - Replay flash: sampled every frame from the click, the dark photo layer's opacity went from 1
    to 0 in one frame with no fade, in Chrome and in Playwright's Firefox (headless), with the page
    already dark. Flushing on the photo layers, subtask 01's fix, works in the app. A headed
    Firefox wasn't checked.
  - At 1440, 850, and 390 px, light and dark: the intro, both Appearance menus (the header's ends
    at 546 px on a 390 × 844 screen, the sign-in page's at 647 px), every signed-in page and the
    sign-in page. The header still sticks, with no horizontal scroll and no browser errors.

## Acceptance criteria

- [ ] Each step above is in the app and matches its prototype in light and dark
- [ ] The scene settings are user settings, with a migration, and apply without a reload
- [ ] Reduced motion keeps the weather and the intro off
- [ ] No horizontal scroll at 390 px and no browser errors on any view
- [ ] `docs/architecture.md` records the scene (assets, WebGL, settings), and `prototypes/README.md`
      notes that the design is ported
