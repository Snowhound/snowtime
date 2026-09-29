# 066: Weather for the Baltic scenes

Status: done

The 24 Baltic images reuse the five mountain effects (`snow`, `rain`, `seeds`, `fireflies`,
`leaves` in `src/lib/scene/weather.ts`), picked per image in `IMAGE_WEATHER`. They often
don't match the picture. Snow and rain blow the same way on every image, whatever the wind
does in the picture: rain's `SLANT` and snow's leftward drift are constants. Some scenes
need an effect the five don't cover. Design the weather per image, so it looks like part of
the scene, then build it.

## Wind

Wind direction is required (Kait, 2026-09-28). Snow and rain follow the image's wind: the way
the reeds, grass, trees, clouds, and waves lean. The wind has a direction and a strength per
image, and can differ between the light and dark images. A calm image keeps straight-down
snow. The leaves' drift and the seeds' breeze should take the same wind, so one image doesn't
blow two ways.

## New effects

Decided with Kait (2026-09-28): two new shaders, and variants of the existing ones for the
rest. Each one is another shader to maintain and to pace (task 063), so a tuned existing
effect comes first. Revised after Kait's first review the same day: the airborne sparkle was
overdone, and the drift in a band made no sense.

| Weather  | Built from | What it shows                                                                      |
| -------- | ---------- | ---------------------------------------------------------------------------------- |
| Glitter  | new        | A few white specks at a time flashing on snow or frost, in rectangles of the image |
| Mist     | new        | Soft banks drifting slowly along a band near the horizon                           |
| Midges   | new        | Specks idling in small groups over the water; at night fireflies on the bank       |
| Flurries | snow       | Few, large, slow flakes                                                            |
| Blowing  | snow       | Fine grains over the whole screen, falling fast, blown flatter near the ground     |
| Spray    | snow       | Droplets of a pixel or two torn off the waves                                      |
| Sprinkle | rain       | A few raindrops                                                                    |
| Drizzle  | rain       | Short, faint streaks, falling steeply                                              |
| Squall   | rain       | Long streaks, slanted hard, in gusts                                               |
| Motes    | seeds      | Specks glinting in low sun, without fluff; dust is more of them                    |

Kait's review (2026-09-28):

- **Glitter** should look like snow glittering under a streetlight: specks of a pixel or two,
  only on the ground. Nothing in the air, and no rays. It fits winter and November's frost,
  not March onward. Second review: white by day too (blue looked wrong), only a few glints
  at a time, each flashing quickly, and never on water. Rather than masks from the pictures,
  each glitter image lists up to three rectangles where snow or frost lies (`ZONES`); a
  recomposed image updates them. Third review: the quick flashes were too fast. The specks
  shimmer slowly again, and a full glint shows in only one or two places at a time, for 1.5
  seconds. `weather.html` has sliders to tune it and the other effects.
- **Blowing snow** follows Kait's configurable weather prototype: fine grains over the whole
  screen, falling fast, with a slant that grows with the wind. Wind often picks up near the
  ground, so the path isn't a straight line: `shear` strengthens the wind below the image's
  horizon, and the snow arcs toward the side.
- **Wind particles** (spray, drift) are a pixel or a few at most.
- Midges were Kait's idea for land July, in place of motes by day and fireflies at night.
  Dragonflies would be too hard to draw. Second review: a few per group, flying lazily,
  just above the water, not mid-screen. Fireflies never among them: one or two on the bank.
- **Seeds** on the open coast (May to July, September) are a few pixels at most.
- Coast April is sunny: one-pixel dust by day, nothing at night. Coast March's wind comes
  off the sea, even on a calm day.
- Land January and February swapped: sparse snow suits January's stream, and February's
  open lake has the room for glitter.
- Land July's midges fly a little faster, mostly by the cliff where they show; the fireflies
  keep to the far bank.
- Fourth review: Kait tuned the images with `weather.html`'s sliders, and the table holds the
  values. Land February's glitter skips the jetty and has to be strong by day to show; if it
  still doesn't work, it becomes very little snow. Coast January glints over the whole lower
  half, less on the snowy shore than on the ice (a zone's fifth number scales its opacity).
  Land April is clear, so it gets coast April's one-pixel dust instead of rain.
- Land October's leaves stood out in front of the tinted picture; they're smaller and
  fainter now. Land September's are right as they are.

The lighthouse beam (the task 065 November) and land December's aurora are painted into
the images. They stay still: animating them needs a position in the image, which the task
065 recomposition moves.

## Per image

From the task 062 images, surveyed on 2026-09-28 and revised after Kait's review. Wind: →
blows left to right, ← right to left. The task 065 images move things around but keep each
month's concept, so the effects should hold. Check the wind, each horizon, and each band
again on the task 065 finals.

Coast:

| Month | The picture                                     | Light           | Dark           | Wind            |
| ----- | ----------------------------------------------- | --------------- | -------------- | --------------- |
| Jan   | Frosted reeds, frozen bay, clear sky            | glitter         | glitter        | calm            |
| Feb   | Ice rubble, clear sky, wind-bent pines          | blowing         | blowing        | → light         |
| Mar   | Breaking floes, sun, calm open water            | sprinkle        | sprinkle       | ← off the sea   |
| Apr   | Cliff, still hazy sea, clear sky                | dust, one pixel | none           | ← off the sea   |
| May   | Alvar with sea thrift, clear sky                | seeds, fine     | seeds, fine    | light           |
| Jun   | Dunes, whitecaps, grass leaning left            | seeds, fine     | seeds, fine    | ← moderate      |
| Jul   | Alvar, fair-weather clouds                      | seeds, fine     | fireflies, few | light           |
| Aug   | Still sunset, islet                             | motes           | mist (liked)   | calm            |
| Sep   | Haystack, grass leaning right                   | seeds, fine     | mist, thick    | → moderate      |
| Oct   | Whitecaps breaking from the right               | squall          | squall         | ← strong, gusty |
| Nov   | Storm and spray; task 065 adds night fog        | spray           | mist           | ← strong        |
| Dec   | Frosted pebbles, pink dawn, halo round the moon | blowing, few    | blowing, few   | ← off the sea   |

Countryside:

| Month | The picture                                   | Light                       | Dark                                  | Wind           |
| ----- | --------------------------------------------- | --------------------------- | ------------------------------------- | -------------- |
| Jan   | Frozen stream, hoar frost, clear sky          | flurries                    | glitter                               | calm           |
| Feb   | Frozen lake, ski tracks, sun                  | glitter                     | glitter                               | calm           |
| Mar   | Bog, snow patches, bright overcast            | drizzle                     | mist                                  | calm           |
| Apr   | Manor park, clear sky                         | dust, one pixel             | none                                  | calm           |
| May   | Wooded meadow; fog in the dark image          | seeds                       | mist                                  | calm           |
| Jun   | Daisy meadow, barn                            | seeds, slightly more        | fireflies, slightly more              | calm           |
| Jul   | River under a sandstone cliff, haze           | midges by the cliff         | midges, two fireflies on the far bank | calm           |
| Aug   | Stubble and bales; fog in the dark image      | dust                        | mist (liked)                          | calm           |
| Sep   | Road, rowan, morning mist                     | a few leaves, in its colors | mist                                  | → light, gusty |
| Oct   | Road through autumn birches                   | leaves, smaller, fainter    | leaves, smaller, fainter              | light          |
| Nov   | Hoar frost, iced pond, sunrise                | frost                       | frost                                 | calm           |
| Dec   | Snowy forest road, clear sky; aurora at night | snow, sparse                | snow, sparser                         | calm           |

## Surviving recomposition

The effects don't depend on where a subject is, so the task 065 images can move the
lighthouse or the manor without changing them. Two things are rows of the image, as
fractions of its height, mapped through the photo's crop: each image's horizon (shear starts
there, and fireflies keep just above it) and the bands that mist, spray, and midges keep to.
Glitter's zones are rectangles of the image. A recomposed image changes those numbers only. Nothing is placed at a point in the image.

## Prototype

Built on 2026-09-28 in `prototypes/scene.js`, compared on `prototypes/weather.html`
(`prototypes/README.md` has the presets and fields), and revised after Kait's first review.
Every effect takes a wind in screen heights per second, gusts, shear below the horizon, and
factors for amount, size, fall, and opacity. Next: Kait compares the revised presets in
motion on a real screen, then the app gets them. Things to judge there:

- The blowing snow's arc near the ground, and whether coast February needs more wind.
- Whether the white day glitter shows on the bright snow, and the spray and dust at their
  small sizes.
- The midges' pace, day and night.
- The strength of each wind, and the mist's opacity behind the tagline on each night.

Kait signed off on the look after the fourth review. A code review (2026-09-28) then changed the
prototype without changing the look:

- Each entry in `IMAGE_WEATHER` names its preset (`preset`) instead of copying its fields.
  `weatherFor()` merges the preset, then the image's horizon and fields, then the slider
  overrides.
- Each effect has an `fps` target, and blowing snow and spray set 60 in their presets. The
  prototype paces like the app: every nth display refresh. Its old 22 ms gate drew 40 fps on a
  120 Hz screen and 30 on a 60 Hz one, not the 45 it meant to.
- Glitter's glint cycle no longer depends on the point count, so a resize doesn't jump every
  speck to another point of its cycle. `peaks` now counts glints on a 1440 × 900 screen, the
  size of a full-screen window, so a larger screen shows proportionally more.
- The mist hashes its lattice cells with integers, which stays exact in `mediump`, and skips
  the noise where a pixel is too faint to show.
- The band, horizon, zones, and point count are worked out on a start or a resize, not every
  frame.

The falling paths' math (`pathX`, `fallPass`, `gustTime`) checked out, and the other `sin`
hashes take bounded item ids.

Measured in headed Chrome on the built-in 120 Hz screen (Apple silicon), at 1440 × 900 with
the glass sign-in card, three runs each. GPU time is per second of the page, glass blur
included:

| Image                | Effect            | Before        | After         |
| -------------------- | ----------------- | ------------- | ------------- |
| Coast August dark    | mist              | 40 fps, 57 ms | 30 fps, 40 ms |
| Land February light  | glitter, amount 4 | 40 fps, 44 ms | 30 fps, 35 ms |
| Coast February light | blowing           | 40 fps, 46 ms | 60 fps, 67 ms |

Per frame the mist costs about 1.35 ms of GPU, glitter and blowing snow about 1.15 ms. A
low-end GPU still needs a check once the app has them.

## Porting notes

- The app draws rain as quads (`quads` in `weather.ts`); the prototype still draws it as
  points. The slant moves into the quad's direction.
- The app's fragment shaders are `mediump`, and a uniform used by both stages must match its
  precision, so the midges' `u_glow` comes in as a varying there. The mist's integer hash
  needs `highp uint` (as written), and its noise coordinate `v_p` needs `highp`: in `mediump`
  its fraction is too coarse at 7 times the texture's scale.
- Frame-rate targets as in the prototype: blowing snow, spray, rain (so the squall), leaves,
  and the midges at 60, the rest at 30. Kait lowered the mist to 15 in both, since it barely
  moves (2026-09-28), and checked by eye that it looks the same. A preset's `fps` overrides its effect's.
- The data keeps its prototype shape: presets by name, image entries naming a preset and the
  fields they change. The app leaves out `LEGACY_WEATHER` and the slider overrides.
- The Weather hint names the preset (`hint`), so each new preset needs
  `scene_effect_*` messages in English and Estonian.
- `bandClip` must use the app's `background-position` (`center 20%`).

## Port

Ported on 2026-09-28 to `src/lib/scene/weather.ts`: the wind, the tuning uniforms, glitter, mist,
insects, the `none` preset, and `PRESETS`, `HORIZONS`, `ZONES`, and `IMAGE_WEATHER` as in the
prototype. Each new preset hint has a `scene_effect_*` message in English and Estonian.

Checked on the dev app the same day at 1440 × 900 with glass surfaces, against `weather.html`,
on 19 images light and dark (all four effects' mountain images, and the glitter, blowing,
rain, mist, midge, and leaf images of both Baltic collections):

- Each image draws the prototype's item count at the prototype's rate, headless and headed on
  the built-in 120 Hz screen: 60 fps for blowing snow, spray, rain, leaves, and the midges, 15
  for the mist, and 30 for the rest. The timer page draws half the items at the same rates.
- Coast and land April draw nothing at night.
- Reduced motion, the Weather switch, and a hidden tab stop the weather; it restarts when the
  tab shows again.
- The taglines read over the mist on the sign-in and timer pages.
- No console errors.

Not measured: GPU time per second (the prototype's figures are above). A low-end GPU still
needs a check.

After the task 065 images merge, check `HORIZONS`, `ZONES`, the mist, spray, and midge bands,
and each image's wind against the new pictures, in the prototype and the app together.

Re-measured on the task 065 images (2026-09-28, in the app and the prototype), from the old and
new pictures side by side (`art/snowtime-backgrounds/065/wxsheet.py`): the horizons of 15
recomposed images, the frost zones of coast December and land November, the land July midge
and firefly zones, and the mist bands of coast November and land May. Coast August, land March,
and land September keep their bands, and land February its zones. The winds are unchanged.
Still to do: Kait checks them in motion on the finals.

Kait's first look in motion (2026-09-29), and a check of every horizon, band, and zone drawn on
the finals:

- Land July: the midges sit lower and farther left, at the cliff's foot and on the river, and
  the fireflies slightly lower and farther right, along the far bank.
- Land September, land May, and land March by night: the mist bands start lower, off the trees
  and, in March, off the moon. March's mist is also denser and reaches down over the lake.
- Land February: one glitter zone of three now covers the sun's and the moon's reflection, so
  a third of the specks glint there, a little brighter.
- Land November by night: no moon, so the frost is fainter and sparser, and shimmers and glints
  more slowly.
- Land April by night: ground mist at the foot of the near trunks, just above the flower bed, fainter along the far
  trees, and hardly any by the manor, where there was none. Mist can now keep to zones in place
  of a band: each bank keeps to one zone's rows and columns, fading out past its sides.
- Land October by night: the leaves are dull rust and olive, and fainter, to suit the moonlit
  trees, which are almost grey.
- Coast January: glitter brightest on the sunny side by day and around the moon's path by
  night, with the night toned down to land February's.
- Coast April by night: sea fog below the moon, clear of the cliff, where there was none.
- Coast May and June by night: fewer, fainter seeds.
- Land September by night: the mist also reaches the foreground, over the road and grass, in
  more and wider banks.
- Coast March: wet snow blowing in off the sea, in place of the straight-falling sprinkle, whose
  preset is gone. By day its far flakes are grey-blue, so they show against the pale sky.
- Land March by day: wet snow too, in a gentler wind, in place of drizzle, whose preset is gone.
- Coast by day: the seeds, motes, and dust were near-white specks of a pixel or two, which
  vanish against the coast's pale skies (224 to 254 under the light tint, against 201 to 237
  on land). They're warm mid-tones now, and the fine seeds a little larger, still a few pixels.
- Coast August by night: the mist lies on the open water, fading out at the rocks on the left,
  in wider banks. Across the rocks it lay as a flat smear, so it stays off them. Half the banks
  lie low along the island's foot, below the trunks, thickest from the start and clearing
  now and then, over about 90 seconds (Kait, 2026-09-29).
- The horizons all match the pictures.
- Coast September by night (Kait, 2026-09-29): thick fog in place of the fine seeds. It
  lies in three zones: over the bay and the far shore, low in the reeds right of the haystack,
  and thinner over the near grass at the haystack's foot, clear of the haystack itself. Kait
  still has to check it in motion. By day it keeps its seeds, but smaller and fewer, since they
  stood out too much.
- Coast December (Kait, 2026-09-29): a very slight snow blowing in off the sea, in place of
  the frost. By day its far flakes are grey-blue, as coast March's.
- Land January by night (Kait, 2026-09-29): glitter in place of the flurries, most on the
  moonlit snow under the moon, less over the far field, the bank right of the stream, and the
  moon's reflection in the stream. The weather takes up to four zones for it, up from three.
- Coast January by night (Kait, 2026-09-29): the glitter gathers along the moon's path on the
  ice, and is a little fainter and slower overall.

## Approach

1. **Survey.** For each Baltic image, light and dark, write down what the weather has to fit:
   the wind and which way it blows, the light (sun, overcast, night), and surfaces such as
   snow, ice, water, or fields. Propose its effect and wind, and settle each with Kait. Survey
   the task 065 finals, or the task 062 images that 065 keeps, since a recomposed image can
   change the wind.
2. **Prototype.** Build the wind and the chosen effects in `prototypes/scene.js` first, and
   compare them on the images with Kait.
3. **Port.** Move the chosen weather to `src/lib/scene/weather.ts` and `IMAGE_WEATHER`.

## Constraints

- Each effect keeps the renderer's pattern: one draw call, no buffers, point counts scaled to
  the screen, and an `fps` target (task 063). Every frame also redraws the glass blur, so an
  effect should run at 30 fps unless it moves too far per frame for that.
- App pages run the weather calm, the sign-in page at full pace. Reduced motion, the Weather
  switch, and a hidden tab still stop it.
- The weather must not make the taglines or the page harder to read. Mist and fog need that
  check most.
- The Weather hint names the image's effect. A new effect needs its hint in English and
  Estonian (`scene_effect_*` in `messages/`).

## Acceptance criteria

- [x] Each Baltic image, light and dark, has an agreed effect and wind, recorded in the task
- [x] Snow and rain take a wind direction and strength per image
- [x] The new effects Kait picked are prototyped and agreed in `prototypes/scene.js`
- [x] The app matches the prototype, and `IMAGE_WEATHER` gives each image its agreed weather
- [x] Each effect holds its frame rate on a 120 Hz screen with glass surfaces, and the
      taglines read over it
- [x] New effects have hints in `messages/en.json` and `messages/et.json`
- [x] `docs/architecture.md`, "Seasonal scene", describes the wind and the new effects, and
      `prototypes/README.md` matches the app
