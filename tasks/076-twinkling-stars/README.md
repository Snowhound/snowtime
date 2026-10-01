# 076: Twinkling stars

Status: todo

Kait (2026-09-30): a new effect for the Baltic countryside's November night (`land-november`,
dark), "vilkuvad tähed". Stars sit at fixed points in the sky. Each one's brightness changes a
little all the time, as the atmosphere makes real stars scintillate, and now and then it
flashes brighter, as glitter's specks do, without moving. On November they replace the frost
the image's dark theme shows today.

Kait (2026-10-01): the stars suit most of the Baltic night skies, partly cloudy ones and ones
with a moon that isn't full and glaring included. There they come on top of the image's
current effect, which mostly stays (the mist, for example), so the renderer must draw two
effects at once (subtask 01). Countryside December also gets an aurora (subtask 02).

Prototype: [`prototypes/stars.html`](../../prototypes/stars.html) shows the stars over each
candidate image's photo, kept to the open sky and out of a circle around the moon, with
sliders for count, placement, size, brightness, twinkle, and flashes. Tune the look there
first; branches and GPU cost come after. The sliders' defaults are Kait's first November pick
(2026-10-01): placement 91, twinkle speed 0.3, and the rest as the page first had them. Kait's
picks per image (2026-10-01) sit over those defaults (`tuned` in the page's `SKIES`) and are in
the table.

Order of work (Kait, 2026-10-01): first the benchmark in subtask 01, which settles how two
effects share the canvas. Then the stars and the aurora (subtask 02) move into
`weather-renderer.ts` and `IMAGE_WEATHER` as production code, matching the prototype's look.
Give their shaders the review of task 069, subtask 06 (integer hash, `flat` varyings,
`mediump` fragments, no per-item branches, tight points) where the timing shows a need, and
keep that design: stateless items, one draw call per effect, no per-frame uploads.

Candidates, with the dark effect each shows today:

| Image         | Effect today | Sky                                                         | Kait's pick                                                 |
| ------------- | ------------ | ----------------------------------------------------------- | ----------------------------------------------------------- |
| land-november | frost        | Moonless; stars replace the frost                           | 52 stars, placement 88, brightness 0.6                      |
| land-april    | mist         | Moonless, right of the trees                                | 5 stars, placement 96                                       |
| land-may      | mist         | Bright early-summer night                                   | 11 stars, placement 72                                      |
| land-july     | midges-night | Bright moon low on the right                                | 50 stars, placement 75                                      |
| land-october  | leaves       | Crescent moon, a few small clouds                           | 10 stars, placement 7                                       |
| land-december | snow         | Moonless; stars and an aurora (subtask 02) replace the snow | Placement 90, brightness 0.5; aurora defaults               |
| coast-march   | flurries     | Bright moon; stars replace the flurries                     | 24 stars, placement 89, brightness 0.6                      |
| coast-april   | mist         | Bright moon on the left                                     | 16 stars, placement 89, brightness 0.5                      |
| coast-may     | seeds-fine   | Bright early-summer night; stars replace the seeds          | 42 stars, placement 96, brightness 0.5, bright vs faint 0.8 |
| coast-july    | fireflies    | Moonless, low clouds only                                   | The defaults; fireflies toned down (below)                  |
| coast-august  | mist         | Small moon over the islet                                   | 42 stars, placement 90, brightness 0.4                      |
| coast-october | squall       | Stars only in the gaps between clouds                       | 10 stars, placement 85, brightness 0.45                     |

Left out: land September, which Kait tried and dropped (2026-10-01), foggy or overcast skies
(coast November and September, the mountain autumn), and a large glowing moon (land January to
March and August, coast December, the other mountain images).

Coast July's fireflies under the stars were too busy (Kait, 2026-10-01). In the prototype's
`scene.js` they are fewer (`amount` 0.3 to 0.18) and fly and glow at 0.55 times the speed: the
fireflies effect now takes `tempo`, as the midges do. The app's `weather-renderer.ts` and
`IMAGE_WEATHER` follow with the stars, with coast July's golden frames updated.

## Acceptance criteria

- [ ] A stars effect whose zones are each image's open sky, with a keep-out circle for the
      moon, tuned with Kait in the prototype and then the bench
- [ ] `IMAGE_WEATHER` gives stars, in the dark theme, to the images Kait picks from the table,
      next to their current effect where Kait keeps it, with Weather hints and their messages
      in every language
- [ ] Coast July's fireflies toned down in the app as in the prototype
- [ ] Golden frames added for the new cases, and the effect's GPU time per frame recorded
