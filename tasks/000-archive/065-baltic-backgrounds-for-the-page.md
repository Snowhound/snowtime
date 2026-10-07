# 065: Baltic backgrounds composed for the page

Status: done

Task 062 shipped 24 Baltic scenes, each in a light and a dark version, on branch
`scenery-collections`. The concepts hold and several images work (Kait, 2026-09-28), but
they were composed as stand-alone photographs, not as backgrounds behind the app. Regenerate
the scenes from scratch with the page in mind, keeping each month's concept, and replace
the task 062 files where the new image is better.

## What went wrong in task 062

- **The tint.** The scene always sits under a tint of the page color, even with a clear
  background (Kait). Images were judged bare, and only the shortlist sheet approximated the
  tint.
- **The middle.** The best parts sit in the middle, where the app covers them: the manor in
  land April, for example. The brief asked for "a calm, open area in the middle", but the
  interest wasn't moved out to the sides.
- **Top and bottom.** Even on a 16:9 screen, some images lose detail at the top and bottom
  (land October: the tree crowns and the road).

## What the page does to an image

These come from the code on `scenery-collections`. Check them again before relying on them.

- **Tint** (`.scene-tint` in `src/styles.css`, `STRENGTHS` in `src/lib/scene/scene.ts`): a
  vertical gradient of the page color over the image. The page color is `#f4faff` light and
  `#0b1622` dark. At the top it covers `strength × 70%`, at the bottom
  `strength × 115%`. Dimmed, the default, is 0.4 light and 0.55 dark: 28% to 46% of
  near-white over light images, and 38.5% to 63% of near-black over dark ones. Full is 0.2
  and 0.3: 14% to 23% light, 21% to 34.5% dark.
- **Vignette** (`.scene-vignette`): dark pages darken toward the edges, up to 32% black in
  the corners; light pages whiten toward the edges, to 28% of `rgb(216 227 239)`. The corners
  lose the most.
- **Crop** (`.scene-photo-image`): `background-size: cover` with `background-position:
  center 20%`. A screen wider than 16:9 cuts the height, 20% of the cut at the top and 80% at
  the bottom. A 1920 × 1080 screen with browser chrome (about 1920 × 950, 2:1) keeps about
  88% of the height, losing about 2% at the top and 10% at the bottom. A 21:9 screen keeps
  about 76%. A narrower screen cuts the sides. A phone in portrait shows only the middle
  quarter of the width.
- **What covers the middle:**
  - App pages: the header and the content column are `max-w-6xl` (1152 px) and centered.
    That leaves side bands of about 140 px each at 1440 px wide, 380 px at 1920, and 700 px
    at 2560, and the content is often cards with glass surfaces.
  - The sign-in page: a card about 380 px wide, centered, from about a quarter to three
    quarters of the height at 1440 × 900, with the tagline above it.

## Brief for the new images

Everything in task 062's "Image briefs" still holds (Baltic, photographs, no people, the
month's light and never a holiday, the dark image an edit of the light one), except where
this list changes it.

- **Interest at the sides.** Put the subject, such as the manor, the lighthouse, the
  haystack, or the barn, in the outer bands, about 8–30% and 70–92% of the width. Leave
  the outer 8% plain, since the vignette and narrow screens take it. The middle 40% stays
  calm and readable, with sky, water, field, snow, or a path. It should still look like a
  scene on its own, because phones show only the middle.
- **A vertical safe area.** Keep what matters between about 10% and 75% of the height. The
  top 10% and the bottom 25% may be cropped: sky and foreground texture only there.
- **Judged under the page.** Every sheet shows each candidate as the page shows it: tint at
  both strengths, the vignette, the crop at 16:10, 2:1, and 21:9, and the app column and
  sign-in card over it. Brightness and contrast targets apply to that composite, not the
  bare image. Nights may need to be a little lighter (Kait's theory for the dimmed tint), and
  their color matters: the older shortlist nights' colored light on ice and snow worked
  better than the flat fix-round nights, but the small, faint moon and the more realistic
  sky from the fix rounds should stay.
- **Light images under the dimmed tint.** Dimmed, the default, turns some light scenes very
  white (Kait, 2026-09-28); dark mode holds up better. This is fixed in the app, not in the
  pictures: see the next section.
- **Concepts.** Start from each month's task 062 idea in `picks.json` (062 image folder), and
  from alternatives Kait liked: land June `june-a-1001` and coast March `march-d-1008`. Each
  can be recomposed, with the subject moved to a side.
- **The existing images.** Kait will say which task 062 images already work. Those can stay,
  so the new round only needs the months that change.

## Pipeline

Follow task 062's image folder (`art\snowtime-backgrounds\062\README.md`) and
`design/backgrounds/baltic.md`. Put new work in `art\snowtime-backgrounds\065\`. Keep what
task 062 learned:

- Render at 1344 × 768. A seed repeats its composition only at the same size and prompt.
- An edit never uses the seed that made its source.
- Night edits follow the night rules in 062's `fixes.md`.
- Finals: every object an enhance prompt names gets painted in, so use the plain prompts
  (`ENHANCE_PROMPT=plain` in `finals.py`). Match the night exposure and the color to the
  source. Restart ComfyUI between Qwen and SeedVR2.
- Kait checks the pages by hand; don't screenshot every image on every page.

## A lighter tint in light mode

Kait's decision (2026-09-28): lessen the dimmed tint slightly in light mode, rather than
generate other pictures for it. Prototype it first, in `STRENGTHS` in `prototypes/scene.js`,
for example 0.4 instead of 0.5 for `dimmed.light`, and compare it with the current tint on
the washed-out scenes. Then apply the chosen value in `STRENGTHS` in `src/lib/scene/scene.ts`
and record it in `docs/architecture/scene.md`. The tint is what keeps the text
readable, so the new value must keep the taglines readable and each season's `titleLight` at
5:1 or better on every image (task 062). This can go ahead of the new images, and the
sheets then use the new value.

Done on 2026-09-28: `dimmed.light` is 0.4 in the prototype and the app, and Kait prefers
it on the washed-out scenes. The 5:1 target, as it was open: The `seasons.ts` comment measures
`titleLight` against the flat page, tint, and muted colors, which the strength doesn't
change. Measured over the images instead (the sign-in page at 1440 × 900, the median pixel
behind the headline), only land March reached 5:1 even at 0.5; the rest were 2.9 to 4.9,
lowest on land February and coast July. 0.4 lowers each by up to 0.25. Land April, June,
and July also have dark patches behind the tagline, below 2:1 at either value.
Decided with Kait (2026-09-28): the target applies over the images, and the colors change
rather than the pictures. Even on white, the old `titleLight` colors reached only about
5.8:1, so 5:1 over an image needed a near-white sky behind the tagline. Each `titleLight` is
now 0.08 darker in OKLCH lightness, with its hue kept: winter `#0f4e99`, spring `#205a18`,
summer `#5e4d00`, autumn `#784100`, about 7.8:1 on the page. Over the task 062 images at
dimmed 0.4 (the mean color behind the tagline, without its glow), every light image
reaches 5.2:1 or better except land April (4.6) and June (1.8), which the new round
recomposes. The new images keep bright, calm sky behind the tagline.

Open: whether to render wider than 16:9 (for example 2:1), so wide screens crop less. That
changes `photoWidth` and the files' size, and portrait phones would see an even narrower
slice. Decide with Kait after the first previews.

## Acceptance criteria

- [x] The sheets show every candidate under the tint (dimmed and full), the vignette, the
      crops, and the app column and sign-in card
- [x] Kait has picked each month's image for both collections, keeping task 062 images
      that work
- [x] Each new image keeps its subject out of the covered middle and its detail inside
      the vertical safe area
- [x] The finals replace the task 062 files in `public/backgrounds/<collection>/` as
      `<id>-<theme>-02-<width>.avif`, since `public/` files are cached for a week
      (`scene.ts` then needs each image's version), and `design/backgrounds/baltic.md`
      records each one
- [x] The dimmed tint is slightly lighter in light mode, prototyped first, with the
      taglines readable. Measuring `titleLight` at 5:1 or better on every final moved to
      task 067.
- [x] `IMAGE_WEATHER` is checked against each new image (Kait, 2026-09-29)

The image follow-ups in `art\snowtime-backgrounds\065\README.md` ("Follow-ups") moved to task 067.
