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

## Acceptance criteria

- [ ] Each step above is in the app and matches its prototype in light and dark
- [ ] The scene settings are user settings, with a migration, and apply without a reload
- [ ] Reduced motion keeps the weather and the intro off
- [ ] No horizontal scroll at 390 px and no browser errors on any view
- [ ] `docs/architecture.md` records the scene (assets, WebGL, settings), and `prototypes/README.md`
      notes that the design is ported
