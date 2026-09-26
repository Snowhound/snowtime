# 051: Regenerate the seasonal backgrounds as one place

Status: todo

The seasonal backgrounds (task 031, `design/backgrounds/`) come from 1672 × 941 originals.
The upscale to 3840 px in the backgrounds README adds no detail, so snow, rock, and distant
ridges look soft. Winter light and dark show the same valley, but spring, summer, and autumn
each show a different place. Regenerate all four seasons as the winter valley in that season,
then upscale them with a generative model that adds detail. This runs in ComfyUI on the
Windows machine with the RTX 4090 (24 GB).

Models, chosen on 2026-09-26:

- Qwen-Image 2.1 (7B, open weights, released 2026-09-21) makes the new seasons in its edit
  mode. One checkpoint generates and edits. Its native 16:9 size is 2752 × 1536, and the
  edit node takes reference images up to 4096 px. Editing the winter image keeps its
  layout far better than generating from a text prompt.
- SeedVR2 7B (ByteDance, one-step restoration) upscales to 3840 px. It adds texture but
  invents far less than a Flux or SD "creative" upscale. FP16 or FP8 fits in 24 GB.
  Clarity Upscaler was dropped on 2026-09-25 because it redrew small shapes (backgrounds
  README).

## Steps

1. Update ComfyUI; Qwen-Image 2.1 needs a build from 2026-09-21 or later. Load the official
   Qwen-Image 2.1 edit workflow ([ComfyUI docs][qwen-docs]) and install
   [`comfyui-seedvr2-tilingupscaler`][seedvr2-tiling] with the SeedVR2 7B model.
2. Copy `design/backgrounds/winter-light-01.png` and `winter-dark-01.png` from the Mac. The
   originals are gitignored, so they aren't in the clone.
3. For each of spring, summer, and autumn, edit `winter-light-01.png` into the light version
   at 2752 × 1536. Fix the seed and make several candidates. Prompt along the lines of:
   "Same place, same camera, same mountains, trees and rocks, keep the composition exactly.
   Change the season to late summer: snow melted, green alpine meadow, wildflowers." If the
   ridges or tree lines drift, add a Depth or Canny ControlNet made from the winter image.
4. Make each dark version by editing that season's chosen light version ("Same scene at
   night, moonlit, starry sky"), not from winter-dark or from scratch, so light and dark
   line up. Also regenerate winter light and dark at 2752 × 1536 from the originals, so all
   eight images come from the same model.
5. Upscale all eight to 3840 px wide with the SeedVR2 tiling node: 1024 px tiles, 32–64 px
   padding, anti-aliasing 0–0.2. From 2752 px this is 1.4×. For more detail, first run a
   tiled img2img pass with Flux or Qwen at denoise 0.2–0.3. That pass can redraw small
   shapes such as young trees, so check light against dark afterwards.
6. Bring the 3840 masters back to the Mac and encode the page files with the `cwebp` and
   AVIF commands in the backgrounds README, at the same quality settings.
7. Rewrite the backgrounds README's "Upscaling" section for the new method, and update the
   size and file-size numbers in its table.

## Acceptance criteria

- [ ] All four seasons show the winter valley: same camera, peaks, ridges, and tree lines.
- [ ] Each season's light and dark images line up when toggled at 100%.
- [ ] Rocks, snow, and distant ridges show detail at a 100% crop of the 3840 files, with no
      waxy smoothing and no warm tint on the rocks.
- [ ] The 32 page files (WebP and AVIF, 1920 and 3840) replace the old ones in `design/backgrounds/` and
      `public/backgrounds/`, at sizes near the current 110–650 KB.
- [ ] The backgrounds README records the models, versions, workflow settings, and prompts
      that made the images.

[qwen-docs]: https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1
[seedvr2-tiling]: https://github.com/moonwhaler/comfyui-seedvr2-tilingupscaler
