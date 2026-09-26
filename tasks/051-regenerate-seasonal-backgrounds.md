# 051: Regenerate the seasonal backgrounds as one place

Status: todo

The seasonal backgrounds (task 031, `design/backgrounds/`) come from 1672 × 941 originals.
The upscale to 3840 px in the backgrounds README adds no detail, so snow, rock, and distant
ridges look soft. Winter light and dark show the same valley, but spring, summer, and autumn
each show a different place. Regenerate all four seasons as exactly the winter valley in that
season, then upscale them with a generative model that adds detail. This runs in ComfyUI on
the Windows machine with the RTX 4090 (24 GB).

Models, chosen on 2026-09-26:

- Qwen-Image 2.1 (7B, open weights, released 2026-09-21) makes the new seasons in its edit
  mode. One checkpoint generates and edits. Its native 16:9 size is 2752 × 1536, and the
  edit node takes reference images up to 4096 px. Editing the winter image keeps its
  layout far better than generating from a text prompt.
- SeedVR2 7B (ByteDance, one-step restoration) upscales to 3840 px. It adds texture but
  invents far less than a Flux or SD "creative" upscale. FP16 or FP8 fits in 24 GB.
  Clarity Upscaler was dropped on 2026-09-25 because it redrew small shapes (backgrounds
  README).

## Season looks

The winter image fixes the place: camera, peaks, ridges, rocks, and every tree stay where
they are, and the edits add or remove none of them. The season changes only snow, ground
cover, foliage color, sky, and light. The sun (light) and moon (dark) stay where winter has
them, upper right, so a season change doesn't move the light.

Each season keeps the mood of its current image, which the site's colors were picked from:

| Season | Keep from the current image                                                  | Site colors to match                                                         |
| ------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Winter | Everything; it's the layout source.                                          | White and ice (`#f4f8fd`, `#2265b9`); snow particles.                        |
| Spring | Misty, soft overcast light, wet rocks, snow left on the peaks, new green.    | Fresh green and meltwater teal (`#cfeccb`, `#33722a`); rain particles.       |
| Summer | Clear blue sky, deep green forest, alpine meadow, lupines and white flowers. | Firefly yellow and green (`#f6e7a1`, `#76630b`); seeds and fireflies.        |
| Autumn | Fog under a heavy sky, amber and rust foliage and ground cover.              | Amber and rust (`#f6c07e`, `#94560a`); leaves about `#b55226` and `#d99433`. |

The colors come from `SEASON_COPY` in `src/lib/seasons.ts` and `EFFECTS` in
`src/lib/weather.ts`. Autumn's color comes from larches among the existing conifers and from
the ground cover, since the edit can't add deciduous trees.

No stream or standing water shows in the foreground or middle ground: the image is still, and
only the weather moves, so nearby water would look frozen. A lake on the valley floor and
rivers in the distance are fine. The current spring and autumn images have a foreground
stream; the new ones must not.

## Steps

1. Update ComfyUI; Qwen-Image 2.1 needs a build from 2026-09-21 or later. Load the official
   Qwen-Image 2.1 edit workflow ([ComfyUI docs][qwen-docs]) and install
   [`comfyui-seedvr2-tilingupscaler`][seedvr2-tiling] with the SeedVR2 7B model.
2. Copy all eight originals, `design/backgrounds/<season>-<theme>-01.png`, from the Mac. The
   originals are gitignored, so they aren't in the clone. Winter is the layout source; the
   others are references for palette and mood only.
3. For each of spring, summer, and autumn, edit `winter-light-01.png` into the light version
   at 2752 × 1536. Give the edit node two reference images: the winter image first, for the
   layout, and that season's current light image second, for palette and mood. Fix the seed
   and make several candidates. Prompt with the season's row in [Season looks](#season-looks),
   along the lines of: "Same place, same camera, same mountains, trees and rocks, keep the
   composition of image 1 exactly. Change the season to late summer with the colors and light
   of image 2: snow melted, green alpine meadow, wildflowers, clear sky. No stream or water in
   the foreground." If the ridges or tree lines drift, or the second reference pulls in its
   own layout, add a Depth or Canny ControlNet made from the winter image.
4. Make each dark version by editing that season's chosen light version ("Same scene at
   night, moonlit, starry sky, moon in the upper right"), not from winter-dark or from
   scratch, so light and dark line up. Pass the season's current dark image as a second
   reference for the night palette. Also regenerate winter light and dark at 2752 × 1536
   from the originals, so all eight images come from the same model.
5. Upscale all eight to 3840 px wide with the SeedVR2 tiling node: 1024 px tiles, 32–64 px
   padding, anti-aliasing 0–0.2. From 2752 px this is 1.4×. For more detail, first run a
   tiled img2img pass with Flux or Qwen at denoise 0.2–0.3. That pass can redraw small
   shapes such as young trees, so check light against dark afterwards.
6. Bring the 3840 masters back to the Mac and encode the page files with the `cwebp` and
   AVIF commands in the backgrounds README, at the same quality settings.
7. Check each season on the sign-in page and an app page, in light and dark, with weather
   on. If a palette moved away from the site colors, adjust `SEASON_COPY` or the effect's
   colors in the same change, keeping `titleLight` at 5:1 or better.
8. Rewrite the backgrounds README's "Upscaling" section for the new method, and update the
   size and file-size numbers in its table. The masters are about 3840 × 2143, because
   2752 × 1536 is slightly wider than the old 16:9 originals.

## Acceptance criteria

- [ ] All four seasons show exactly the winter valley: same camera, peaks, ridges, rocks, and
      trees, and the sun or moon in the same place.
- [ ] Each season's light and dark images line up when toggled at 100%.
- [ ] Each season matches its row in [Season looks](#season-looks), and no stream or standing
      water shows in the foreground or middle ground.
- [ ] Taglines and weather particles read on every new image, in light and dark.
- [ ] Rocks, snow, and distant ridges show detail at a 100% crop of the 3840 files, with no
      waxy smoothing and no warm tint on the rocks.
- [ ] The 32 page files (WebP and AVIF, 1920 and 3840) replace the old ones in `design/backgrounds/` and
      `public/backgrounds/`, at sizes near the current 110–650 KB.
- [ ] The backgrounds README records the models, versions, workflow settings, reference
      images, and prompts that made the images.

[qwen-docs]: https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1
[seedvr2-tiling]: https://github.com/moonwhaler/comfyui-seedvr2-tilingupscaler
