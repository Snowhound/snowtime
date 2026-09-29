# Baltic backgrounds

The 24 images of the Baltic coast and Baltic countryside collections, each in a light and a
dark version, made on 2026-09-28. Task 062 made the first set; task 065 recomposed 19 of them
for the page, with the subject at the side and a calm middle, as version `02`. This file records
how the current files were made; the steps and settings they share with the season images are
in [README.md](README.md).

| Files                                                       | What they are                                  |
| ----------------------------------------------------------- | ---------------------------------------------- |
| `masters/<collection>/<id>-<theme>-<version>-3840.webp`            | Masters, 3840 × 2168 px, lossless WebP, local. |
| `public/backgrounds/<collection>/<id>-<theme>-<version>-1920.avif` | For the pages, 1920 px wide, 67 to 326 KB.     |
| `public/backgrounds/<collection>/<id>-<theme>-<version>-3840.avif` | For the pages, 3840 px wide, 133 to 607 KB.    |

The collection folders are `coast` for the `coast-<month>` images and `countryside` for the
`land-<month>` images. The version is `02` for the images task 065 replaced (`PHOTO_VERSIONS`
in `src/lib/scene/scene.ts`) and `01` for the rest: coast January and June, and land January,
February, and August. Coast February kept its light image and got a new night, so both its
files are version `02`.

## Sources

Each image starts from a 1344 × 768 render, picked by Kait from previews and fix rounds. The
light image is text to image with Qwen-Image 2.1, sometimes followed by an edit or a tone
lift. The dark image is an edit of the light one. Each image's section below gives these
prompts and seeds.

- Task 062 images: `art\snowtime-backgrounds\062\out\fix3\<month>\`.
- Task 065 images: `art\snowtime-backgrounds\065\`, listed in its `finals-sources.json`.
  The light images are 40-step renders in `out\shortlist\`, except land April and land June,
  whose lights are the edits in `out\fix1\`. The nights are in `out\shortlist\`,
  `out\nightfix\` (fix rounds and variants), and `out\nights062\` (coast February). The
  prompts are built by `prompts.py` and `run.py` in that folder; the sections below quote them
  from the metadata ComfyUI saved in each render. The task 065 light prompts end with a
  layout paragraph (`STYLE`) that puts the subject near one side and keeps the middle calm.
  Night prompts for the land re-picks use `NIGHT_KEEP_PLAIN`, which names no objects, since
  a night prompt that named rocks added fieldstones and boulders, and one that named moonlight
  on water put a moon glitter on fog and a dry field.

## Finals

The steps are the season images' (README, "Making the images"), with three changes: the
enhance prompts, the night exposure, and the color match.

1. **Resize.** Lanczos to 2720 × 1536, as before.
2. **Enhance.** Qwen-Image 2.1 edit, 40 steps, CFG 1, euler, simple scheduler, seed 5001
   unless the table says otherwise. The prompts differ from the season images'. Every
   object a prompt names tends to be painted in: task 051's winter prompt painted its
   mountain valley over the frozen bay, "reeds" added reeds, "snow" snowed on April, and
   "rocks" added stones to the May meadow. The first images used prompts with a short list
   of what to keep; the later retries use prompts that name no objects at all
   (`enhance-plain-062.txt`), which kept every scene. The table under each image names its
   prompt, and all the prompts are listed below.
3. **Night exposure.** Without "night" in the prompt, the enhance lit the nights up by 23
   to 36 levels of mean grey and frosted them; with it, they came out a few levels darker.
   A dark image whose enhanced mean differs from its source's by more than 3 gets one global
   gamma that brings the mean back (the "Night gamma" column).
4. **Detail.** img2img at denoise 0.25, 25 steps, seed 5101, with the enhance prompt and no
   reference image, as before.
5. **Color match.** Each Lab channel's mean and spread are set to the source's (Reinhard
   transfer, `color_match` in `finals.py`). This undoes the enhance's global shifts in
   exposure and white balance, such as a cooler light on the February ice, and moves no
   shapes.
6. **Upscale and encode.** SeedVR2 to 3840 and the AVIF and lossless WebP encode, with the
   README's settings (seed 100; AVIF quality 45 at 3840 and 58 at 1920).

On the RTX 4090, an enhance took 246 s, a detail pass 66 s, an upscale about 35 s once the
model was loaded, and an encode about 40 s.

## Checks

Task 065's 37 finals used the plain enhance prompts only, with seed 5001, and each needed one
attempt. They're within 1.4 of their source's mean grey, with an edge correlation of 0.87 to
0.97. The flags (spot counts, a local change of 20 to 21 in coast November's night and land
June's light) were checked by eye on source and final sheets and accepted as noise. Sheets:
`065\sheets\finals-coast.jpg` and `finals-land.jpg`.

The task 062 finals:

Each final was compared with its source at 1344 × 768: mean grey within 5 (all 48 are
within 1.6), the edge correlation of `match()` in `062\sheet.py` (0.71 to 0.97; the lowest
are nights and leafy scenes, where noise and leaves move the edge map), the share of pale
pixels for snow and frost, round bright spots for a sun, moon, or lamp, and the largest
change in a 16 × 9 grid of mean grey. The spot count and the grid flag noise in bright skies
and foliage, so every image was also compared with its source by eye, at 2720 and again as
a final. Images that drifted (added snow, frost, rocks, or reeds, or whiter snow) were made
again: three with seed 5002 and eight with the plain prompts. A column check of
the sky at the tiler's tile edges found no seams. Sheets: `062\sheets\finals-coast.jpg` and
`finals-land.jpg`.

## Enhance prompts

Each file is in `prompts\` in the image folder. The table under each image names the one it used.

- `enhance-062.txt`:

  > Keep <image1> exactly: the same place, camera, composition, trees, rocks, water, sky, light and colors; the season stays as it is; add, remove or move nothing, and add no snow or frost. Render it as a sharp, detailed photograph with crisp, fine textures.

- `enhance-night-062.txt`:

  > Keep <image1> exactly: the same place, camera, composition, trees, rocks, water, sky, light and colors; add, remove or move nothing. It is night, and the exposure and the brightness of every part stay exactly as in <image1>, neither brighter nor darker, and no light, glow, frost or snow is added. Render it as a sharp, detailed night photograph with crisp but dim textures and a clean, dark sky.

- `enhance-plain-062.txt`:

  > Keep <image1> exactly as it is: the same place, camera, composition, light and colors; add, remove or move nothing. Render it as a sharp, detailed photograph with crisp, fine textures.

- `enhance-plain-night-062.txt`:

  > Keep <image1> exactly as it is: the same place, camera, composition, light and colors; add, remove or move nothing. It is night, and the exposure and the brightness of every part stay exactly as in <image1>, neither brighter nor darker. Render it as a sharp, detailed night photograph with crisp but dim textures and a clean, dark sky.

- `enhance-winter-062.txt`:

  > Keep <image1> exactly: the same place, camera, composition, trees, rocks, ice, water, sky, light and colors; add, remove or move nothing. Every bit of snow, ice and hoarfrost in <image1> stays exactly as it is, and none is added anywhere else. Render it as a sharp, detailed photograph with crisp textures in the snow, the ice, the frost, the branches and the rocks.

- `enhance-winter-062a.txt`:

  > Keep <image1> exactly: the same place, camera, composition, trees, reeds, rocks, ice, water, sky, light and colors; add, remove or move nothing. Every bit of snow, ice and hoarfrost in <image1> stays exactly as it is, and none is added anywhere else. Render it as a sharp, detailed photograph with crisp textures in the snow, the ice, the frost, the reeds, the branches and the rocks.

- `enhance-winter-night-062.txt`:

  > Keep <image1> exactly: the same place, camera, composition, trees, rocks, ice, water, sky, light and colors; add, remove or move nothing. It is night, and the exposure and the brightness of every part stay exactly as in <image1>, neither brighter nor darker, and no light or glow is added. Every bit of snow, ice and hoarfrost in <image1> stays as it is, as dim as it is there, and none is added anywhere else. Render it as a sharp, detailed night photograph with crisp but dim textures and a clean, dark sky.

- `enhance-winter-night-062a.txt`:

  > Keep <image1> exactly: the same place, camera, composition, trees, reeds, rocks, ice, water, sky, light and colors; add, remove or move nothing. It is night, and the exposure and the brightness of every part stay exactly as in <image1>, neither brighter nor darker, and no light or glow is added. Every bit of snow, ice and hoarfrost in <image1> stays as it is, as dim as it is there, and none is added anywhere else. Render it as a sharp, detailed night photograph with crisp but dim textures and a clean, dark sky.

## Baltic coast

### `coast-january`

Pick `january-a-1007`.

- Light: text to image, seed 1007:

  > A shallow bay of the Baltic Sea in Estonia in January, frozen over and dusted with snow, tall reeds white with hoarfrost in the lower left and right foreground, the flat ice stretching to a low wooded shore far away. A clear, very cold day: the low sun on the right, a pale blue sky, sparkling frost. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 35 mm lens. The middle of the frame is calm and open, with the detail toward the edges and the bottom. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1018:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, muted blue, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch soft light, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. If there is a moon, there is one, small, as a real moon looks through a 35 mm lens: a tiny, overexposed white disc with a little glow. Moonlight on water is one faint, narrow glitter broken by ripples, directly below the moon, and there are no other bright reflections. A cold, clear winter night. A small moon low on the right, with one faint, narrow glitter directly below it on the ice. The frosted reeds and the ice are pale grey-white in its light, only slightly blue. A few faint stars.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-winter-062a.txt` | 5001 | - | seed 5101, 0.25 | 213 KB | 387 KB |
| dark | `enhance-winter-night-062a.txt` | 5001 | 0.859 | seed 5101, 0.25 | 142 KB | 287 KB |

### `coast-february`

Pick `february-a-1012`. The light is from task 062; the night is new in task 065.

- Light: text to image, seed 1012:

  > Late February on the Baltic coast of Estonia: the frozen sea, with broken ice floes piled into ridges along a low stony shore, snow on the beach and a few wind-bent pines on the left. A clear, crisp afternoon: a pale blue sky turning pastel at the horizon, the low sun on the right casting long blue shadows across the ice. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 35 mm lens. The middle of the frame is calm and open, with the detail toward the edges and the bottom. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1014:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. If there is a moon, there is one, small, as a real moon looks through a 28 mm lens: a tiny, overexposed white disc with a little glow, near a side edge of the frame, never in the middle. Moonlight on water is one faint, narrow glitter broken by ripples, directly below the moon, and there are no other bright reflections. A clear, cold February night. A small moon low near the right edge. The piled ice ridges and the snow on the beach take a cool blue moonlight with soft silver highlights and deep blue shadows; the pines on the left are black. A few faint stars.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-winter-062.txt` | 5001 | - | seed 5101, 0.25 | 199 KB | 362 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.845 | seed 5101, 0.25 | 165 KB | 316 KB |

### `coast-march`

Pick `coast-march-b-1011` (task 065).

- Light: text to image, seed 1011:

  > The Baltic shore in Estonia in March as the sea ice breaks up. At the right edge of the frame, a large granite boulder at the waterline with broken ice slabs piled against it and old snow on the stones around it. In the middle, open blue water with scattered floating ice floes, flat to a clear horizon. Bright, fresh spring light, a pale blue sky with thin white clouds. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1012:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. If there is a moon, there is one, small, as a real moon looks through a 28 mm lens: a tiny, overexposed white disc with a little glow, near a side edge of the frame, never in the middle. Moonlight on water is one faint, narrow glitter broken by ripples, directly below the moon, and there are no other bright reflections. A cool March night under a clear, deep blue sky. The ice slabs and the old snow take a pale blue moonlight; the boulder and the open water are dark, with a faint sheen on the water.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 169 KB | 324 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.886 | seed 5101, 0.25 | 93 KB | 191 KB |

### `coast-april`

Pick `coast-april-b-1001` (task 065).

- Light: text to image, seed 1001:

  > The North Estonian limestone cliff in April, seen from along its edge. At the right edge of the frame, the grey layered limestone cliff drops to a stony shore, with a few bare trees with the first green haze of buds on its top, their crowns well below the top of the frame. The calm pale blue Baltic Sea fills the middle and the left, flat to the horizon, with stones along the shore in the foreground. Clear, bright spring light. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1002:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. If there is a moon, there is one, small, as a real moon looks through a 28 mm lens: a tiny, overexposed white disc with a little glow, near a side edge of the frame, never in the middle. Moonlight on water is one faint, narrow glitter broken by ripples, directly below the moon, and there are no other bright reflections. A calm spring night with scattered clouds. A small moon high near the left edge, above the faint glitter of its light on the water. The limestone cliff is pale grey-blue in the moonlight, with no frost on it or on the grass; the trees on the cliff top are black.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 180 KB | 324 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.889 | seed 5101, 0.25 | 122 KB | 236 KB |

### `coast-may`

Pick `coast-may-a-1008` (task 065).

- Light: text to image, seed 1008:

  > A low limestone shore on the island of Saaremaa in late May. At the left edge of the frame, a few dark junipers and a grey boulder, with pink thrift in flower among flat grey rock slabs and fresh green grass in the lower left. In the middle, flat limestone slabs lead to the calm blue sea and a clear horizon. Bright, clear sunlight and a pale blue sky. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1019, a fix round, seed 1019, since the first night had a glow and a reflection with no source:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. A white night in May, with no moon and no sun: the whole sky an even, dim blue-violet, a little paler all along the horizon, with no brighter spot and no glow anywhere. The calm sea is dark blue-grey with only a faint, even sheen, and no bright reflection. The rocks and junipers are dark.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 226 KB | 388 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.802 | seed 5101, 0.25 | 131 KB | 239 KB |

### `coast-june`

Pick `june-c-1009`.

- Light (the shortlist render, kept): text to image, seed 1009:

  > Sand dunes on a quiet Baltic shore in June: pale sand and marram grass in the foreground, low pines on the dunes on the left, a calm blue sea stretching to the horizon. A bright clear day with a few high clouds. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 35 mm lens. The middle of the frame is calm and open, with the detail toward the edges and the bottom. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1010, made in fix2:

  > Edit <image1>: change only the time of day. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season, the snow, the water and the ground of <image1>. A white night: a dim blue-violet sky with a pale glow low over the sea, the dunes and pines dark, the calm sea reflecting the glow.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-062.txt` | 5001 | - | seed 5101, 0.25 | 197 KB | 361 KB |
| dark | `enhance-night-062.txt` | 5001 | 0.788 | seed 5101, 0.25 | 150 KB | 285 KB |

### `coast-july`

Pick `coast-july-b-1001` (task 065).

- Light: text to image, seed 1001:

  > A coastal alvar on the island of Saaremaa in July. At the right edge of the frame, an old wooden post windmill with a shingled roof stands among dark junipers. In the middle, flat limestone ground with thin grass, wild thyme and small yellow and white flowers, and the sea a blue line in the distance. A big, bright summer sky with a few white cumulus clouds low at the sides. Bright, warm sunlight. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1002:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. A July night well after sunset: a muted blue sky with a pale glow low on the horizon and a few dark clouds. The alvar ground is dark grey-green, not pale, with no frost or dew shine; the windmill and the junipers are dark shapes.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 152 KB | 294 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.794 | seed 5101, 0.25 | 97 KB | 197 KB |

### `coast-august`

Pick `coast-august-a-1004` (task 065).

- Light: text to image, seed 1004:

  > A rocky Baltic shore on a warm, calm August evening. Smooth granite rocks and boulders in the foreground, larger toward the left edge. The sea is flat and glassy; a low island covered in pines lies on the horizon near the right edge of the frame, with the low warm sun above it. A soft pink and gold sky, pale in the middle. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1005:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. If there is a moon, there is one, small, as a real moon looks through a 28 mm lens: a tiny, overexposed white disc with a little glow, near a side edge of the frame, never in the middle. Moonlight on water is one faint, narrow glitter broken by ripples, directly below the moon, and there are no other bright reflections. A dark, partly cloudy August night: soft clouds over most of the sky, a small moon in a gap above the island near the right edge, a few faint stars, no Milky Way. The calm sea is deep blue with a faint glitter below the moon, the island a black line, the rocks near black with a cool blue sheen. Reflections are short and soft, with no vertical streaks.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 179 KB | 331 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.915 | seed 5101, 0.25 | 103 KB | 197 KB |

### `coast-september`

Pick `coast-september-b-1003` (task 065).

- Light: text to image, seed 1003:

  > A coastal meadow on Matsalu Bay in Estonia in September. At the left edge of the frame, a lone old haystack on poles beside a weathered wooden fence of leaning poles. In the middle, pale grass and golden reeds lead to the calm blue bay and a low wooded shore far away. Crisp, clear light, long shadows, a pale blue sky. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1031, the overcast variant, seed 1031:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky covered by low cloud, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue light with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. An overcast September night: low, soft cloud over the whole sky, faintly lighter over the bay, with no moon and no stars, and a low mist over the bay and the meadow. Dew on the grass, no frost. The haystack and the fence are dark shapes; the bay is dim blue-grey.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 209 KB | 357 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.752 | seed 5101, 0.25 | 143 KB | 281 KB |

### `coast-october`

Pick `coast-october-a-1012` (task 065).

- Light: text to image, seed 1012:

  > A sandy Baltic beach on the Curonian Spit in Lithuania on a windy October day. At the left edge of the frame, a dune with beach grass bent by the wind. In the middle, a wide pale beach and white-capped waves on a grey-blue sea. Clouds breaking up, with bright sunlight on the sand and the sea and a wide pale sky in the middle; darker clouds only near the right edge. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1023, a fix round, seed 1023, with a sea of its own instead of the day's waves:

  > Edit <image1>: change it to a night photograph taken from the same spot. Keep the camera, the horizon, the dune and its grass, and the line of the beach exactly where they are in <image1>, with the same shapes. The sea is different: a new sea state, with other waves in other places, other lines of surf and foam on the beach, none of the crests of <image1>. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the dune close to black, nothing lit or shaded as if by the sun. If there is a moon, there is one, small, as a real moon looks through a 28 mm lens: a tiny, overexposed white disc with a little glow, near a side edge of the frame, never in the middle. Moonlight on water is one faint, narrow glitter broken by ripples, directly below the moon, and there are no other bright reflections. A windy October night: clouds with wide breaks, the sky deep blue between them. The crests of the waves are faint silver-grey, the wet sand has a cool sheen, the dune grass is dark.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 144 KB | 277 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.91 | seed 5101, 0.25 | 83 KB | 165 KB |

### `coast-november`

Pick `coast-november-a-1001` (task 065).

- Light: text to image, seed 1001:

  > A grey storm sea in November breaking on a stone pier that runs in from the left edge of the frame, with a small white lighthouse with a black lantern at its end, at about one sixth of the width from the left. Waves spray over the pier; wet dark rocks in the lower left. The middle is open, rough grey-green sea to the horizon. A low, even grey sky, lighter in the middle, cold diffuse light. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1002:

  > Edit <image1>: change it to a night photograph taken from the same spot. Keep the camera, the horizon, the pier or breakwater, the lighthouse and the shore rocks exactly where they are in <image1>, with the same shapes. The sea is different: a new sea state, with other waves in other places, rolling long swells and breaking crests. The air is humid, with drizzle and sea mist, so light scatters in it. A realistic night photograph, like a long exposure: the rocks close to black, nothing lit or shaded as if by the sun. A dark, humid November night under low cloud, with no moon: no disc and no glow in the sky. The lighthouse lamp is lit, a warm light; its beam is a pale shaft through the misty air, reaching out over the sea, and a long, broken reflection streak of its light runs across the waves toward the camera. The spray and the mist near the lighthouse glow faintly; the rest of the sea is deep blue-grey, the rocks near black.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 162 KB | 298 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.731 | seed 5101, 0.25 | 110 KB | 214 KB |

### `coast-december`

Pick `coast-december-a-1008` (task 065).

- Light: text to image, seed 1008:

  > A pebbly Baltic shore in Estonia in December after the first snow. At the left edge of the frame, large granite boulders capped with snow, with thin shore ice between them. In the middle, grey pebbles with a thin layer of snow lead to the calm, dark grey-blue sea. A low pink sun sits just above the horizon near the right edge; the sky is pale pink and grey, brightest in the middle. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1009:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. If there is a moon, there is one, small, as a real moon looks through a 28 mm lens: a tiny, overexposed white disc with a little glow, near a side edge of the frame, never in the middle. Moonlight on water is one faint, narrow glitter broken by ripples, directly below the moon, and there are no other bright reflections. An overcast December night: low, even cloud, a small moon glowing faintly through it low near the right edge, with a faint glitter below it. The sea is dark blue, the shore ice and the snow on the stones pale blue-grey in the dim light. No pink.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 229 KB | 396 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | - | seed 5101, 0.25 | 114 KB | 209 KB |

## Baltic countryside

### `land-january`

Pick `january-c-1008`.

- Light: text to image, seed 1008:

  > A small river winding through a wide snowy valley in southern Estonia in January, frozen with dark open water in places, alders and willows along its banks white with hoarfrost, gentle snowy hills beyond. A bright, frosty day with a clear pale blue sky and the low sun. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 35 mm lens. The middle of the frame is calm and open, with the detail toward the edges and the bottom. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1009, made in fix2:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, muted blue, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch soft light, so the scene reads clearly. If there is a moon, it is small, as a real moon looks through a 35 mm lens: a tiny, overexposed white disc with a little glow. Stars are faint and few, with no Milky Way. Moonlight on water is a faint, narrow glitter broken by ripples, only below the moon. A cold, clear January night. A small moon high on the right. The snow and the frosted trees are pale in its light, only slightly blue; the open river water is black. A few faint stars.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-winter-062.txt` | 5001 | - | seed 5101, 0.25 | 214 KB | 408 KB |
| dark | `enhance-winter-night-062.txt` | 5001 | 0.859 | seed 5101, 0.25 | 139 KB | 275 KB |

### `land-february`

Pick `february-c-1009`.

- Light: text to image, seed 1009:

  > A wide frozen lake in Finland in late February, covered in wind-packed snow, with a lone old wooden jetty in the lower left and cross-country ski tracks curving out across the lake toward a far shore of dark spruce forest. A clear, crisp day: a deep blue sky, the low sun on the right, long shadows on the snow. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 35 mm lens. The middle of the frame is calm and open, with the detail toward the edges and the bottom. No people, no animals, no cars, no text or signs, no decorations.

  Tone lift (`tone()` in `run.py`): `{"band": [0.3, 0.45, 0.6]}`.

- Dark: an edit of the light image, seed 1010, made in fix2:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, muted blue, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch soft light, so the scene reads clearly. If there is a moon, it is small, as a real moon looks through a 35 mm lens: a tiny, overexposed white disc with a little glow. Stars are faint and few, with no Milky Way. Moonlight on water is a faint, narrow glitter broken by ripples, only below the moon. A cold February night with thin high cloud. The snow on the lake is dim grey-white with only a slight blue tint, the ski tracks faint, the spruce forest black. A few faint stars.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-winter-062.txt` | 5001 | - | seed 5101, 0.25 | 194 KB | 388 KB |
| dark | `enhance-winter-night-062.txt` | 5001 | 0.903 | seed 5101, 0.25 | 178 KB | 364 KB |

### `land-march`

Pick `land-march-a-1001` (task 065).

- Light: text to image, seed 1001:

  > An Estonian raised bog in March during the thaw. A narrow wooden boardwalk enters at the bottom left corner and runs along the left side of the frame into the distance, past a few small stunted pines near the left edge. In the middle, a dark open bog pool with thin melting ice mirrors the sky, with patches of old grey snow on red-brown moss around it. Stunted pines stay low on the far horizon. Soft, bright light under a pale sky with white clouds. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1002:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. If there is a moon, there is one, small, as a real moon looks through a 28 mm lens: a tiny, overexposed white disc with a little glow, near a side edge of the frame, never in the middle. Moonlight on water is one faint, narrow glitter broken by ripples, directly below the moon, and there are no other bright reflections. A cool March night with thin cloud and a deep blue sky. The bog pool reflects the sky; the boardwalk and the old snow are pale blue-grey; the stunted pines are black.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 253 KB | 468 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.867 | seed 5101, 0.25 | 130 KB | 261 KB |

### `land-april`

Pick `land-april-a-1001` (task 065).

- Light: text to image, seed 1001:

  > The well-kept park of an old Estonian manor in late April, on a sunny day. Near the right edge of the frame, a two-storey manor house with pale yellow plaster and a portico, seen across the park. An alley of huge old lime trees and oaks runs from the left edge across the park toward the manor, seen from the side, the trees in fresh light green leaf with sunlight through their crowns, which end below the top of the frame. In the middle, a wide mown lawn of bright green grass with a carpet of white wood anemones under the trees and a raked gravel path. An open, bright blue sky with light clouds above the lawn. Soft, bright spring sunlight. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

  Then an edit of that render, seed 1002, of which only the manor was kept (rows 360–625, columns 1045–1344 at 1344 × 768, feathered 10 px):

  > Edit <image1>: change only the manor house on the right. Make it a well-kept, coherent classical Estonian manor house of the early 19th century, as a real building would be: a symmetrical two-storey facade in pale yellow plaster with white trim, freshly kept but not new, under a red tiled hipped roof; a central portico of four evenly spaced white columns carrying a triangular pediment, on a low terrace with steps; tall windows with white frames in two even rows, each upper window exactly above a lower one, with equal spacing. Keep its size, place and angle in the frame exactly as in <image1>. Keep everything else in <image1> exactly: the alley of trees, the lawn, the anemones, the path, the sky and the light.

- Dark: an edit of the light image, seed 1072, a fix round (`windows3`), since the first night lit the manor too brightly:

  > Edit <image1>: change only the time of day, to night. Keep the camera and everything in <image1> exactly where it is, with the same shapes; add or remove nothing, and keep the season as it is. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; dark things close to black; pale surfaces catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. A calm spring night under a deep blue sky. The manor is dark: its pale plaster walls and portico are dim grey-blue like the rest of the night, not floodlit. Only two or three of its windows are lit warm yellow from inside, and the rest are dark. The old trees are black and the lawn dark; the anemones are small, dim white flowers in the dark grass, not glowing.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 327 KB | 600 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | - | seed 5101, 0.25 | 124 KB | 237 KB |

### `land-may`

Pick `land-may-b-1012` (task 065).

- Light: text to image, seed 1012:

  > An Estonian wooded meadow in May. At the right edge of the frame, a big old oak in fresh bright green leaf, its crown well below the top of the frame; at the left edge, an ash and a birch in new leaf. In the middle, a wide open meadow of new grass with yellow cowslips, and a few small trees far away on the horizon. Sunlight and soft shadows, a bright blue sky with light clouds. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1065, a fix round (`glow`), since the first night's glow was a thin line on the horizon:

  > Edit <image1>: change only the time of day, to night. Keep the camera and everything in <image1> exactly where it is, with the same shapes; add or remove nothing, and keep the season as it is. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; dark things close to black; pale surfaces catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. A white night in May, with no moon and no sun: the whole sky a dim blue, slowly paler toward the horizon, as a broad, faint, even brightening over the lower part of the sky, with no thin bright line along the horizon and no bright spot. The meadow is misty and dim, the trees dark shapes.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 326 KB | 608 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.891 | seed 5101, 0.25 | 178 KB | 346 KB |

### `land-june`

Pick `land-june-b-1009` (task 065).

- Light: text to image, seed 1009:

  > A hay meadow in full bloom in June, with ox-eye daisies, buttercups and clover. At the right edge of the frame, an old grey wooden barn with a thatched roof, small in the frame. In the middle, the flowering meadow slopes gently away to a low, distant line of birches, and above it an open, bright blue sky with a few small white clouds. Bright, soft sunlight. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

  Then an edit of that render, seed 1030, for sharper flowers:

  > Edit <image1>: redraw only the flowers in the meadow as a real, sharp photograph of an Estonian hay meadow in June: clearly shaped ox-eye daisies with white petals around a yellow centre, yellow buttercups, a little red clover and purple meadow cranesbill among tall green grasses, each flower crisp and in focus in the foreground, getting smaller and denser with distance. Fewer white flowers than in <image1>, with more green grass between them. Keep the barn, the trees, the sky, the horizon, the light and the composition of <image1> exactly.

- Dark: an edit of the light image, seed 1069, a fix round (`plain`), since the first night added fieldstones round the barn:

  > Edit <image1>: change only the time of day, to night. Keep the camera and everything in <image1> exactly where it is, with the same shapes; add or remove nothing, and keep the season as it is. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; dark things close to black; pale surfaces catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. A white night in June: a dim blue sky, a little paler low over the horizon, the meadow dark and a little misty, the barn dark. The buttercups are half closed for the night, small dim yellow buds rather than open flowers.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 249 KB | 437 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.834 | seed 5101, 0.25 | 178 KB | 316 KB |

### `land-july`

Pick `land-july-a-1008` (task 065).

- Light: text to image, seed 1008:

  > A red Devonian sandstone cliff on the bank of the slow Gauja river in Latvia in July. The cliff rises at the left edge of the frame, with a few pines on its top that end well below the top of the frame. The calm river curves through the middle toward a low, distant line of green forest, reflecting an open, bright sky with a few white clouds. Warm, clear summer light. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1009:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. If there is a moon, there is one, small, as a real moon looks through a 28 mm lens: a tiny, overexposed white disc with a little glow, near a side edge of the frame, never in the middle. Moonlight on water is one faint, narrow glitter broken by ripples, directly below the moon, and there are no other bright reflections. A July night: a small moon high near the right edge, a faint glitter on the river below it, and a deep, muted blue sky. The moon is the only light: the sandstone cliff lies in soft, cool shade, dim red-brown, with no sunlit side and no warm light. The forest is black, the river dark blue.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 146 KB | 262 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.847 | seed 5101, 0.25 | 79 KB | 153 KB |

### `land-august`

Pick `august-a-1007`.

- Light: text to image, seed 1007:

  > A harvested wheat field in August with round straw bales scattered across golden stubble, a forest edge and a distant farm on the horizon. Warm golden-hour light from the left, a hazy sky. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 35 mm lens. The middle of the frame is calm and open, with the detail toward the edges and the bottom. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1008, made in fix2:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, muted blue, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch soft light, so the scene reads clearly. If there is a moon, it is small, as a real moon looks through a 35 mm lens: a tiny, overexposed white disc with a little glow. Stars are faint and few, with no Milky Way. Moonlight on water is a faint, narrow glitter broken by ripples, only below the moon. A dark August night with ground mist drifting low over the stubble and a few clouds. No Milky Way; a few faint stars. The bales are dark shapes in the mist, the forest edge black.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-062.txt` | 5001 | - | seed 5101, 0.25 | 254 KB | 433 KB |
| dark | `enhance-night-062.txt` | 5001 | 0.918 | seed 5101, 0.25 | 132 KB | 251 KB |

### `land-september`

Pick `land-september-a-1001` (task 065).

- Light: text to image, seed 1001:

  > A gravel country road in September. At the right edge of the frame, two rowan trees heavy with red berries; at the left edge, a birch with the first yellow leaves. The road enters at the bottom and curves away to the left through open farmland, with morning mist lying low over the fields in the middle. Soft, low sunlight and a pale, bright sky. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1076, a fix round (`plain`), since the first night added boulders and a moon glitter on the fog:

  > Edit <image1>: change only the time of day, to night. Keep the camera and everything in <image1> exactly where it is, with the same shapes; add or remove nothing, and keep the season as it is. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; dark things close to black; pale surfaces catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. A September night with fog lying low over the fields, under a deep blue sky. Dew, no frost. The road is pale grey, the rowans and the birch dark, the berries barely visible.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 284 KB | 511 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.88 | seed 5101, 0.25 | 187 KB | 361 KB |

### `land-october`

Pick `land-october-b-1002` (task 065).

- Light: text to image, seed 1002:

  > A field edge in Estonia in October at peak colour. At the right edge of the frame, a large golden birch and an orange maple, their crowns fully in the frame. In the middle, a gravel track runs along the edge of a pale stubble field toward a low, distant forest of yellow and dark green trees. An open, bright blue sky with a few white clouds. Clear sunlight. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1080, a fix round (`moon`), since the first night put a moon glitter on the dry field:

  > Edit <image1>: change only the time of day, to night. Keep the camera and everything in <image1> exactly where it is, with the same shapes; add or remove nothing, and keep the season as it is. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; dark things close to black; pale surfaces catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. An October night with scattered clouds and a deep blue sky, a few faint stars. The field and the track stay as they are, dry and dim. The trees are dark, their colours barely visible. A small moon in the sky on the left, about a quarter of the way down from the top of the frame: a tiny, overexposed white disc with a little glow, as a real moon looks through a 28 mm lens, and nothing bright below it.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 245 KB | 433 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.917 | seed 5101, 0.25 | 149 KB | 294 KB |

### `land-november`

Pick `land-november-a-1011` (task 065).

- Light: text to image, seed 1011:

  > A meadow in November after the first hard frost. At the left edge of the frame, bare birches; at the right edge, a dark spruce. In the middle, grass white with hoarfrost and a small pond with thin new ice, and a low, distant tree line. The sun has just risen near the right edge; a clear, pale sky, brightest in the middle. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1051, the starry variant, seed 1051:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue starlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Many small stars, with no Milky Way. A clear, frosty November night with no moon in the frame: a deep blue sky full of tiny, pin-point stars, as a real wide-angle night photograph shows them, each a single sharp point, a few a little brighter, with no Milky Way band and no glow around them. The frosted meadow and the pools are pale blue-grey in the starlight; the birches and the spruce are dark.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 254 KB | 463 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | 0.927 | seed 5101, 0.25 | 190 KB | 387 KB |

### `land-december`

Pick `land-december-b-1007` (task 065).

- Light: text to image, seed 1007:

  > A snowy field at the edge of a spruce forest in December after the first snowfall. At the right edge of the frame, snow-laden spruces, their tops inside the frame; a snowy road runs along the forest edge into the distance. In the middle, the smooth snowy field and a low, far line of trees, under an open pale pink-blue sky. A short winter day, the low sun glowing pink near the left edge. A wide 16:9 landscape photograph in natural colours, sharp and detailed, with realistic light, taken with a full-frame camera and a 28 mm lens at eye level. Bright, airy exposure. Composition: the main subject stands close to one side edge of the frame, as described, and nothing tall stands in the middle. The middle third of the frame is calm and open, with soft natural texture only. The upper third of the frame is open sky, pale and bright in the middle, with nothing reaching into it at the centre. The horizon lies a little above the middle of the frame. The bottom quarter is simple foreground texture. No people, no animals, no cars, no text or signs, no decorations.

- Dark: an edit of the light image, seed 1008:

  > Edit <image1>: change only the time of day, to night. Keep the camera, and every building, tree, rock, shoreline and object exactly where it is in <image1>, with the same shapes; add or remove nothing. Keep the season and the ground of <image1> as they are: add no snow, no frost and no ice. The sun and its warm glow are gone. A realistic night photograph, like a long exposure: the sky a deep, clear blue, lighter near the horizon, never electric; trees and dark rocks close to black; snow, ice, sand, pale rock and water catch a cool blue moonlight with soft silver highlights, so the scene reads clearly, and nothing is lit or shaded as if by the sun. Stars are faint and few, with no Milky Way. A December night under a clear, deep blue sky with no moon at all. Soft green northern lights low over the far trees, a few faint stars. The snow is pale blue with a slight glitter, as in a long exposure; the spruces are near black. No pink.


| Theme | Enhance prompt | Enhance seed | Night gamma | Detail | 1920 | 3840 |
| --- | --- | --- | --- | --- | --- | --- |
| light | `enhance-plain-062.txt` | 5001 | - | seed 5101, 0.25 | 199 KB | 362 KB |
| dark | `enhance-plain-night-062.txt` | 5001 | - | seed 5101, 0.25 | 136 KB | 277 KB |


