# Seasonal backgrounds

A landscape per season in a light and a dark version, for the seasonal scene (task 031). The
scene and intro mock-up is `snowtime_login_intro_with_backgrounds.html`. These are the
Mountain valley collection; the Baltic coast and Baltic countryside collections are recorded
in [baltic.md](baltic.md), and their images follow the steps below with the changes listed
there.

| Files                                                        | What they are                                    |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `<season>-<theme>-01.png`                                    | The originals, 1672 × 941 px. Kept as they are.  |
| `masters/mountains/<season>-<theme>-01-3840.webp`            | Upscaled masters, 3840 × 2168 px, lossless WebP. |
| `public/backgrounds/mountains/<season>-<theme>-01-1920.avif` | For the pages, 1920 px wide, 104 to 237 KB.      |
| `public/backgrounds/mountains/<season>-<theme>-01-3840.avif` | For the pages, 3840 px wide, 187 to 431 KB.      |
| `public/backgrounds/mountains/<season>-<theme>-01-400.avif`  | For the pickers, 400 px wide, 2 to 15 KB.        |

The originals and the masters stay local and out of git (`.gitignore`): new images may replace
them, and this README records how to make them again. Only the page files are committed, once,
in `public/backgrounds/<collection>/`, one folder per collection, where the app serves them.
They're AVIF only, because every supported browser decodes it (`docs/architecture.md`,
"Seasonal scene").

`prototypes/scene.js` and, in the app, `src/lib/scene/scene.ts` pick the page size for the
screen; `prototypes/README.md` records how the scene loads them and the load times.

## Making the images

Each original is redrawn sharper at 2720 px by an image edit model that keeps its content, given
extra fine detail by a light second pass, and upscaled to 3840 px by a restoration model. The
content, composition, and light stay the originals'; the passes add texture to snow, rock, bark,
grass, and distant ridges. All eight went through the same steps on 2026-09-27, in ComfyUI on
Windows with an RTX 4090 (24 GB).

1. **Resize.** Pillow resizes each original to 2720 × 1536 with Lanczos. Qwen-Image 2.1 edits
   within a budget of about 2048² pixels, so this is the largest 16:9 size it takes whole.
2. **Enhance.** Qwen-Image 2.1 in edit mode redraws the image with the original as its only
   reference image (`TextEncodeQwenImage21`, `resolution` 0 so the image goes in at its own
   size), 40 steps, CFG 1, euler, simple scheduler, `QwenImage21Cache` off. Seed 5001, except
   winter light 5012 and winter dark 5011. The prompt:

   > Keep \<image1\> exactly: the same place, camera, composition, trees, rocks, water, sky, light
   > and colors; add, remove or move nothing. Render it as a sharp, detailed photograph with
   > crisp textures on rocks, bark, foliage, grass and snow, and clear distant ridges.

   The two winter images get a prompt of their own, because the one above turned their snowy
   slopes into grass and bare rock:

   > Keep \<image1\> exactly: the same place, camera, composition, trees, rocks, sky, light and
   > colors; add, remove or move nothing. It is deep winter and every bit of snow stays: the
   > thick snow covering the foreground slopes and drifts, the snow on the rocks, the heavy snow
   > on every spruce, and the snowy valley. No grass or bare ground shows anywhere. Render it as
   > a sharp, detailed photograph with crisp textures in the snow, the snow-laden branches and
   > the rocks, and clear distant ridges.

3. **Detail.** The same model runs img2img over the enhanced image at denoise 0.25: 25 steps,
   seed 5101, the same prompt with no reference image. This sharpens grass, rock, and bark a
   little more without moving shapes. The images upscaled with and without this pass looked the
   same at page size; with it they measured slightly sharper and encoded 1 to 2% smaller, so all
   eight use it.
4. **Upscale.** `SeedVR2TilingUpscaler` with SeedVR2 7B (`seedvr2_ema_7b_fp16`, VAE
   `ema_vae_fp16`) to 3840 px on the longest side: 1024 px tiles, 128 px padding, `linear`
   blending with `mask_blur` 16, `tile_upscale_resolution` 1536, `Chess` order, anti-aliasing
   0.1, `lab` color correction, seed 100. The DiT loader has `cache_model` on and
   `offload_device` `cuda:0`, so the model stays on the GPU between tiles.
5. **Encode.** ImageMagick flattens the output to RGB (ComfyUI saves RGBA), then:

```sh
magick out.png -background white -alpha remove -alpha off master.png
cwebp -lossless -z 6 master.png -o masters/<collection>/<name>-3840.webp
magick master.png -quality 45 -define heic:speed=2 <name>-3840.avif
magick master.png -filter Lanczos -resize 1920x png:- | magick - -quality 58 -define heic:speed=2 <name>-1920.avif
ffmpeg -i <name>-1920.avif -vf "scale=400:-2:flags=lanczos,format=yuv420p" -c:v libaom-av1 -still-picture 1 -crf 34 -cpu-used 2 <name>-400.avif
```

The 400 px thumbnails for the pickers come from the 1920 file; at `-crf` 34 the busiest scene is
15 KB and shows no artifacts at the pickers' size.

The added detail makes the images harder to compress than the old soft ones. On 2026-09-27
a sweep over the eight masters picked quality 45 for the 3840 files and 58 for the 1920 files:
at 2x zoom quality 45 keeps the grass blades and rock texture, and 40 smooths them. SSIM
against the master is 0.963 or better at 3840 and 0.964 or better at 1920. At the old
settings, 60 and 65, the 3840 files came out about 70% larger and the 1920 files about 25%.

Versions: ComfyUI at commit `79be670e` (2026-09-25); ComfyUI-SeedVR2_VideoUpscaler `4490bd1`;
comfyui-seedvr2-tilingupscaler `a117bf1`; models `qwen_image_2.1_bf16`,
`qwen3vl_8b_int8_convrot` (text encoder), and `qwen_image_2.1_vae_bf16`; ImageMagick 7.1.2-31;
`cwebp` 1.6.0. The ComfyUI API scripts that ran these steps are kept with the local masters.

Things that went wrong, and what the settings above do about them:

- **Seams.** The tiler's `multiband` blending leaves a thin line at every tile edge, visible in
  a clear sky at a third and two thirds of the width. `linear` blending over a wider overlap has
  none.
- **Crashes.** With the DiT offloaded to the CPU between tiles, moving the 16 GB model into RAM
  crashed ComfyUI with an access violation on Windows. With no cache, the tiler reloads the model
  for every tile. Keeping it cached on the GPU avoids both.
- **Memory.** Qwen-Image and SeedVR2 don't fit in memory together (32 GB RAM, 47 GB commit
  limit). Restart ComfyUI between the Qwen steps and the upscale.

## What was tried first

Until task 051 the masters blended two 3840 px upscales of each original, 60%
`realesrgan-x4plus` and 40% Lanczos. That kept every shape but added no detail, so snow, rock,
and distant ridges looked soft.

Clarity Upscaler (Replicate, creativity 0.2) was dropped on 2026-09-25: it gave rocks real
texture but redrew small shapes such as young trees and tinted the rocks warmer, and its runs
often didn't start.

Task 051 first set out to redraw spring, summer, and autumn as the winter valley in each season,
so all four showed one place. Qwen-Image 2.1 edits of the winter image kept the mountains and
lakes, but each season drifted in the foreground, the trees, and the light, and no single master
image carried over to all four seasons convincingly. Enhancing the originals kept the look the
site's colors were picked from, so that's what shipped; the four seasons still show different
places.
