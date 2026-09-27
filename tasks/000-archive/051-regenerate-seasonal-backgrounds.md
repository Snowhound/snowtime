# 051: Regenerate the seasonal backgrounds with real detail

Status: done

The seasonal backgrounds (task 031) come from 1672 × 941 originals, and their old 3840 px
upscale added no detail, so snow, rock, and distant ridges looked soft. Each original is now
redrawn sharper with Qwen-Image 2.1 and upscaled with SeedVR2 7B, keeping its content, light, and
colors; `design/backgrounds/README.md` records the steps, settings, and prompts.

The task first aimed to show all four seasons as the winter valley. The seasonal edits drifted in
the foreground, trees, and light, and no single master carried over to all four seasons, so on
2026-09-27 the goal changed to enhancing the originals (README, "What was tried first").

The same change drops the duplicate page files: `design/backgrounds/` no longer keeps copies of
`public/backgrounds/`, and the WebP set is gone, since every supported browser decodes AVIF.
That leaves 16 committed files instead of 64.

## Acceptance criteria

- [x] Each image keeps its original's content, composition, and light; the winter images keep
      all their snow.
- [x] Rocks, snow, and distant ridges show detail at a 100% crop of the 3840 masters, with no
      tile seams.
- [x] The 16 AVIF page files (1920 and 3840) replace the old files in `public/backgrounds/`, at
      sizes near the old AVIF files' 110–405 KB.
- [x] `design/backgrounds/` holds no copies of the page files, and the app, the prototype, and
      the docs load and describe AVIF only.
- [x] The backgrounds README records the models, versions, workflow settings, and prompts that
      made the images.
- [x] Each season checked on the sign-in page and an app page, in light and dark, with weather
      on: taglines and weather particles read, and `titleLight` stays at 5:1 or better. The dark
      images came out brighter than before (mean luminance up 4 to 7 points of 100), so check
      text on them first.
