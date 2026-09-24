# Seasonal backgrounds

A landscape per season in a light and a dark version, for the seasonal scene (task 031). The
scene and intro mock-up is `snowtime_login_intro_with_backgrounds.html`.

| Files                                   | What they are                                    |
| --------------------------------------- | ------------------------------------------------ |
| `<season>-<theme>-01.png`               | The originals, 1672 × 941 px. Kept as they are.  |
| `masters/<season>-<theme>-01-3840.webp` | Upscaled masters, 3840 × 2161 px, lossless WebP. |
| `<season>-<theme>-01-1920.webp`         | For the pages, 1920 px wide, 140 to 285 KB.      |
| `<season>-<theme>-01-3840.webp`         | For the pages, 3840 px wide, 305 to 650 KB.      |

The originals and the masters stay local and out of git (`.gitignore`): new images may replace
them, and this README records how to make them again. Only the page files are committed.

`prototypes/scene.js` picks the page size for the screen; `prototypes/README.md` records how it
loads them and the load times.

## Upscaling

The masters blend two 3840 px versions of each original, 60% `realesrgan-x4plus` and 40%
Lanczos. Real-ESRGAN alone gives clean edges on ridges, tree lines, and rocks but smooths the
snow and rock texture until it looks waxy; the Lanczos share brings the grain back. The blend adds
no detail the original doesn't have. It keeps the composition and light, and the light and dark
versions of a season still line up, because both steps work pixel by pixel from each original.

Tools: `realesrgan-ncnn-vulkan` v0.2.5.0 (macOS build of 2022-04-24, from the Real-ESRGAN
GitHub releases, models included), ImageMagick 7.1.2, and `cwebp` 1.6.0.

```sh
realesrgan-ncnn-vulkan -i <name>.png -o x4.png -n realesrgan-x4plus     # 6688 × 3764
magick x4.png -filter Lanczos -resize 3840x x4-3840.png
magick <name>.png -filter Lanczos -resize 3840x lanczos-3840.png
magick x4-3840.png lanczos-3840.png -compose blend -define compose:args=60,40 -composite master.png
cwebp -lossless -z 9 master.png -o masters/<name>-3840.webp
cwebp -q 82 -m 6 -sharp_yuv master.png -o <name>-3840.webp
magick master.png -filter Lanczos -resize 1920x png:- | cwebp -q 82 -m 6 -sharp_yuv -o <name>-1920.webp -- -
```

Pass `-n` every time: the binary's default model, `realesr-animevideov3`, is for video frames.
`realesrgan-x4plus-anime` was also tried and rejected: it turns distant tree lines into flat
blobs.

A generative upscaler that paints in new detail was tried and dropped on 2026-09-25. Clarity
Upscaler on Replicate, at creativity 0.2, gave the rocks real texture and sharpened the distant
ridges, but it redrew small shapes such as young trees, which risks the light and dark versions
no longer lining up, and it tinted the rocks warmer. Each run waited up to 9 minutes for a
machine to start, and later runs didn't start at all.
