# 062: A background for every month

Status: todo

The scene shows one image per season, so the same picture stays up for three months
(`seasonByMonth` in `src/lib/scene/scene.ts`). The taglines already follow the month and
the date (task 061), and a picture that changes with them would keep the page fresh. Give
each month its own light and dark image, and keep the four current seasonal images for
the months they fit best.

This is a brainstorm. Nothing below is decided yet.

## Proposed months

The current images go to the middle month of their season. Eight months get new
images, each a light and a dark version that looks like it belongs with the originals.

| Month     | Image  | Idea                                                            |
| --------- | ------ | --------------------------------------------------------------- |
| January   | winter | Current image: deep snow on spruce                              |
| February  | new    | Late winter: low sun on hard snow, long blue shadows            |
| March     | new    | Thaw: snow melting off dark ground, meltwater, grey sky         |
| April     | spring | Current image                                                   |
| May       | new    | Fresh green, bird cherry in bloom, bright light                 |
| June      | new    | White nights: a pale sky at midnight, tall grass, still water   |
| July      | summer | Current image                                                   |
| August    | new    | Late summer: ripe fields, haze, the first dark nights and stars |
| September | new    | First yellow in the birches, cool mornings, mist                |
| October   | autumn | Current image                                                   |
| November  | new    | Bare trees, the first frost, a low grey sky, early dark         |
| December  | new    | First snow, the darkest month, lit windows in the distance      |

Alternatives to weigh:

- Keep the current images at the start of their season (December, March, June,
  September) instead, if they match the first month better. The winter image's deep
  snow suits January better than December.
- Start with fewer new images, for example only November, December, March, and June,
  the months that differ most from their season's picture, and add the rest later.

## Design questions

- **Themes of the images.** Each image shows the month's weather and light, not a
  holiday. A dated tagline shows on a few days, and the picture stays up all month, so a
  Christmas tree or a Midsummer bonfire would clash with the other days' taglines.
- **Weather.** The weather follows the season (`SEASON_EFFECTS` in
  `src/lib/scene/weather.ts`). It can stay by season, or follow the month where the
  picture needs it: rain in March and November, snow in December, no fireflies in the
  white nights of June.
- **Scenery setting.** `sceneSeason` is `auto` or a season. Proposed: `auto` shows the
  month's image, and a chosen season shows that season's current image, so the setting
  and its stored values don't change. The "Auto (season)" label becomes the month, for
  example "Auto (September)". A month picker is possible but adds 12 options for little
  gain.
- **Intro.** The intro plays once a season with the season's lines (task 061, subtask
  01). It can stay seasonal and play over the month's image, or play once a month. Once a
  season keeps it rare, which is why it was set that way.
- **File names.** A table in `scene.ts` maps each month to an image id, so the months
  that reuse a seasonal image load the same file:
  `/backgrounds/<id>-<theme>-01-<width>.avif`, with ids `winter`, `spring`, `summer`,
  `autumn`, `february`, and so on. The head script's `MONTH_SEASONS`
  (`src/lib/device-settings.ts`) and the scene layer's photo stack key on the image id
  instead of the season.
- **Month boundary.** Task 050's mismatch between the server's and the browser's month
  happens at 12 boundaries a year instead of 4. The picture changes in an effect, so it
  follows the browser. Do task 050 first, or together with this one.
- **Size.** 16 new page files at 110–430 KB each add about 4 MB to the repository. A
  page still loads one image per theme.

## Making the images

The new images come from the same local pipeline as task 051, at least at first: ComfyUI
on the RTX 4090 machine, Qwen-Image 2.1, then the enhance and SeedVR2 upscale steps in
`design/backgrounds/README.md`. Task 051 found that editing one master into other seasons
drifts in the foreground, the trees, and the light, so each month starts as a new image
prompted in the originals' style, with a current image as a style reference where that
helps.

Pick by eye from many candidates:

1. For each month and theme, render a batch of low-cost previews (for example 20–40
   seeds at a small size, with fewer steps) across a few prompt variants.
2. Pick the best few side by side with the neighbouring months, so the year reads as one
   set, and put the pick behind the sign-in card to check that the text still reads.
3. Render the picks at full size, then enhance and upscale them.
4. Record the prompt, seed, and settings of each final image in the backgrounds README.

Generated output stays outside the repository until it's picked, and is copied into
`public/backgrounds/` on this task's branch. Each final image needs the contrast check
from task 051: the taglines and the weather must stay readable, and `titleLight` must
stay at 5:1 or better, in light and dark.

## Acceptance criteria

- [ ] The month-to-image table, the weather rule, and the setting's behavior are decided
      and recorded in `docs/architecture.md`, "Seasonal scene"
- [ ] Each new month has a light and a dark image at 1920 and 3840 px in
      `public/backgrounds/`, picked from previews and made with the task 051 pipeline, and
      the README records each one's prompt, seed, and settings
- [ ] With the season on Auto, the scene shows the month's image, and months that reuse a
      seasonal image load the same file
- [ ] Each new image checked on the sign-in page and an app page, in light and dark, with
      weather on: taglines and weather particles read, and `titleLight` stays at 5:1 or
      better
- [ ] `prototypes/scene.js` and `prototypes/README.md` match the app
