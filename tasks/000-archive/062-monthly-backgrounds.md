# 062: A background for every month

Status: done

The scene shows one image per season, so the same picture stays up for three months
(`seasonByMonth` in `src/lib/scene/scene.ts`). The taglines already follow the month and
the date (task 061), and a picture that changes with them would keep the page fresh. Give
each month its own light and dark image, in collections the user picks from, and keep the
four current mountain images as the season images.

## Decisions (2026-09-27)

- **Collections.** The background comes from a collection the user picks, and follows
  the calendar within it (Kait, 2026-09-27): Mountain valley (the four mountain images, by
  season, the default), Baltic coast, and Baltic countryside (12 images each, by month).
  This replaces reusing the seasonal images for January, May, July, and October, and the
  mountain images as a fallback for months. Each Baltic collection's 12 months are
  previewed and picked together, so its year is judged as one set. Until a month has its
  image, it shows a placeholder in the month's colors. The picker is designed in
  `prototypes/settings.html` (see "Scenery collections" in `prototypes/README.md`).
- **Weather.** The weather follows the image, from one table keyed by image id that
  replaces `SEASON_EFFECTS`, using the five existing effects. The Scenery menu's weather
  label names the effect. Each new image's effects are set when its scene is picked, from
  what the scene shows: snow where snow falls, rain on a wet street, fireflies only on a
  dark summer night. The four seasonal images keep theirs.
- **Scenery setting.** `sceneCollection` (`mountains`, `coast`, `countryside`) and
  `scenePin` (an image id in that collection, or null to follow the calendar) replace
  `sceneSeason` (Kait, 2026-09-27). A stored season becomes Mountain valley pinned to that
  season, and `auto` becomes Mountain valley unpinned. Settings > Preferences > Scenery
  picks the collection from a gallery of three radio cards that apply at once, and pins
  behind a "Pin an image" disclosure, so the pin adds no row until it's opened; a
  12-option month select was rejected earlier. A collection has one pin, and choosing
  another collection clears it. The Appearance popover shows the collection with a link to
  the gallery; the sign-in page's Scenery menu has a Collection select.
- **Season copy.** The intro lines, the tagline fallback, and the text colors
  (`SEASON_COPY`, `SeasonProvider`) stay by season: the calendar's, or the pinned image's
  season (Kait, 2026-09-27), so the colors are the ones checked on the image that shows. Each month's image must keep
  its season's `titleLight` at 5:1: December to February with winter's, March to May with
  spring's, June to August with summer's, September to November with autumn's.
- **Intro.** It still plays once a calendar season (`snowtime.introSeason`) with the
  season's lines, and fades in the image that shows. Once a month would repeat each season's
  lines three times.
- **File names.** Each collection in `scene.ts` lists its image ids, in month order for
  the Baltic ones (`coast-january` to `coast-december`, `land-january` to
  `land-december`). Each collection's files are in a folder of their own (Kait,
  2026-09-28): `/backgrounds/<collection>/<id>-<theme>-01-<width>.avif`, so the four seasonal
  files moved to `mountains/` with their names kept. Ids without files draw the placeholder.
  The head script's preload and the scene layer's photo stack key on the image id; the intro
  check keeps `MONTH_SEASONS`.
- **Task 050.** This task doesn't wait for it. The photo and weather are chosen in the
  browser only, so they can't mismatch; the one new mismatch is the month the Settings page
  names as showing, for a few hours at a month start for users off UTC. The month lookup
  takes an optional `timeZone`, so task 050 only has to pass it.
- **Size.** The 48 Baltic page files are 67–425 KB at 1920 px and 133–758 KB at 3840 px,
  26 MB for both collections, about twice the 110–430 KB guessed before the finals: the
  grass, leaves, and frost keep more detail at the task 051 quality settings. A page still
  loads one image per theme.

## Image briefs

The 12 months show Baltic scenes, not more mountain valleys (Kait, 2026-09-27): the four
mountain images are enough. Neighbouring months should be different kinds of place, so
they don't look alike. Every new image follows these rules:

- A photograph in natural color, sharp, with no painterly or HDR look. No sci-fi or
  fantasy.
- Set in the Baltic countries, matching the northern seasons and the Estonian taglines.
- Places can show people's work (streets, houses, boats, lit windows), but no people:
  figures pull the eye from the text.
- The month's light and weather, never a holiday: a dated tagline shows on a few days, and
  the picture stays up all month. No decorations, bonfires, or flags.
- A calm, open area in the middle, where the sign-in card and the taglines sit.
- Brightness close to the current sets: light images as bright as the current light
  images, dark images as dark as the current dark ones. The contact sheets print each
  image's mean luminance.
- The dark image is the same scene at night or at dusk, made as an edit of the light pick.

The ideas come in two sets, coast and land, one per collection, so each year shows one
kind of place. City scenes are on hold because they came out weaker. Each month previews two to
four ideas, and Kait picks from the contact sheets. The prompts are in `prompts.py` in the
image folder (see [Making the images](#making-the-images)).

| Month     | Coast                                 | Land                                                        |
| --------- | ------------------------------------- | ----------------------------------------------------------- |
| January   | Frozen reed bay with hoarfrost        | Snowy bog with frosted pines; frozen river valley           |
| February  | Frozen sea shore with piled ice floes | Frozen lake with a wooden jetty and ski tracks              |
| March     | Ice breaking up on the shore          | Raised bog in the thaw; birch forest in late sun            |
| April     | Limestone cliff above the sea         | Spring flood; old manor park with anemones and first leaves |
| May       | Limestone shore with thrift           | Rapeseed field in bloom; wooded meadow in new leaf          |
| June      | Sand dunes and pines on the shore     | Lake at a white night; hay meadow by an old barn            |
| July      | Coastal alvar under a summer sky      | Rye field with cornflowers; sandstone cliff by a river      |
| August    | Rocky shore on a calm evening         | Harvested field with round bales; heather heath with pines  |
| September | Reed meadow on a bay                  | Bog in autumn colours; rowan road in mist                   |
| October   | Windy shore, sun breaking through     | Forest road in full colour; hilly lake with golden birches  |
| November  | Storm sea on a pier with a lighthouse | Birch avenue in fog; first frost on a meadow                |
| December  | First snow on a pebble shore          | Snowy forest road; red farmhouse in snow                    |

## Making the images

The images come from the task 051 pipeline (`design/backgrounds/README.md`): ComfyUI
on the RTX 4090 machine, Qwen-Image 2.1, then the enhance, detail, and SeedVR2 steps. The
scripts and all output stay outside the repository, in
`C:\Users\kait\projects\personal\art\snowtime-backgrounds\062\` (its `README.md` has the
commands). A seed repeats its composition only at the same size and prompt, so every
round before the final renders at 1344 × 768.

1. **Previews.** Each month's light image, text to image at 12 steps, 12–16 seeds for each
   of its ideas. A contact sheet per month shows the candidates between the neighbouring
   months' images, each with its idea, seed, and mean luminance. Kait shortlists 3–5 per
   month.
2. **Shortlist.** The shortlisted seeds render again at 40 steps, and each gets its dark
   version as an edit at the same size. A second sheet per month shows each pair between
   its neighbours, and again with the dimmed tint and a card over it to check the text.
   Kait picks one pair per month.
3. **Finals.** Each pick goes through the task 051 steps from its 1344 px render: the
   enhance edit at 2720 px, the detail pass, SeedVR2 to 3840 px, and the AVIF encode. Only
   then are the files copied into `public/backgrounds/<collection>/`, and the README records
   each one's prompt, seed, and settings. Done on 2026-09-28, with three changes to the
   task 051 steps that `design/backgrounds/README.md` records: enhance prompts that name no
   objects, since every object a prompt lists tends to be painted in; a night prompt with an
   exposure fix; and a color match to the source before the upscale.

Each final image needs the contrast check from task 051: the taglines and the weather
must stay readable, and `titleLight` must stay at 5:1 or better, in light and dark.

## Weather follow-ups

Set on 2026-09-28: coast June's white night got seeds instead of fireflies, since fireflies
are for a dark summer night. The open follow-ups (wind, new effects, and a check against each
final image) moved to task 066.

## Acceptance criteria

- [x] The collections, the weather rule, and the setting's behavior are recorded in
      `docs/architecture.md`, "Seasonal scene"
- [x] Settings picks the collection and pin as in `prototypes/settings.html`, the
      Appearance popover and the sign-in menu show the collection, and a stored
      `sceneSeason` carries over as a pinned mountain image
- [x] Each month of both Baltic collections has a light and a dark image at 1920 and 3840 px in
      `public/backgrounds/<collection>/`, picked from previews and made with the task 051 pipeline, and
      the README records each one's prompt, seed, and settings
- [x] Unpinned, the scene shows the collection's image and weather for the date; pinned,
      the pinned image, with the tagline in its season
- [x] Each new image checked on the sign-in page and an app page, in light and dark, with
      weather on, and the taglines and weather particles read (Kait, 2026-09-29). Measuring
      `titleLight` at 5:1 or better on the task 065 finals moved to task 067.
- [x] `prototypes/scene.js` and `prototypes/README.md` match the app
- [ ] Once the collections release is promoted, a migration drops `user_settings.scene_season`,
      which the app no longer reads. Moved to task 067.
