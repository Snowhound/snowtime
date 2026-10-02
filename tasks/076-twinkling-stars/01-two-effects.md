# 01: Two effects at once

Status: done

The weather renderer (`src/lib/scene/weather-renderer.ts`) draws one effect per image, at that
effect's `fps` and `resolution`. Stars come on top of an image's current effect (task 076), so
an image's weather can name a second effect.

Cost is in pacing and pixel density, not the draws: a point effect costs 0.03–0.05 ms a frame
and mist 0.10–0.15 ms on an M1 Pro (task 069, subtask 06). Drawing both at the faster effect's
rate and density on one canvas would run the mist at 30 fps and full density instead of 10 fps
and a quarter. The glass doesn't add a cost: it shows a pre-blurred copy of the photo
(`src/lib/scene/glass.ts`), so a weather frame re-blurs nothing.

## Benchmark first

Kait (2026-10-01): measure before building. Settle whether drawing the mist into a texture of
its own is needed at all and whether it helps; only then put the effects into production code.

Variants, run with `bun run perf:weather --variant=…` (`perf/README.md`, "Compare two
variants"), on a mist image with stars over it (land April or coast August) and a fireflies
image (coast July):

1. **Naive.** One canvas; every frame draws the mist, then the stars, at the stars' 30 fps and
   resolution. The simplest code.
2. **Cached mist.** One canvas and context. The mist draws into an offscreen framebuffer at its
   own resolution, only on its own 10 fps beat; every 30 fps frame copies that texture onto the
   canvas and draws the stars over it.
3. **Two canvases.** Each effect on its own canvas and context, at its own rate and
   resolution.
4. **Moved texture**, only if 2 or 3 still cost noticeably: the mist drawn rarely into a texture
   wider than the screen, and moved between draws by a CSS transform on its own canvas, so the
   compositor moves it and WebGL doesn't redraw it.

Measure each on this machine's GPU and with `--swiftshader` (the weak-GPU proxy), on the
sign-in and timer layouts at pixel ratios 1.5 and 2, with `--window=3000`. Compare GPU time per
frame, busy milliseconds per second on the main and compositor threads, the display compositor,
and the GPU process, and dropped frames. Prototype the stars and aurora in the bench roughly for
this; they needn't be the production shaders yet.

Pick the simplest variant that is within noise of the best on both renderers, and record the
numbers and the choice here. Naive wins if it is.

### Results (2026-10-01)

Measured on an M1 Pro and under SwiftShader, sign-in and timer layouts, pixel ratios 1.5 and
2, `--window=3000`, with first versions of the stars and aurora, drawn by the bench before
they moved into `IMAGE_WEATHER`.
Each image is dark: land April (mist and 5 stars), coast August (heavy mist and 42 stars),
coast July (fireflies at 0.18 and tempo 0.55, and 60 stars), and land December (aurora and
60 stars). Cached copies the mist with a textured triangle; a first version that copied with
`blitFramebuffer` cost 11 ms a frame under SwiftShader.

GPU milliseconds per second at the app's pacing, the range over the four layout and pixel
ratio runs. The GPU process's CPU time follows the same order. Busy time on the main and
compositor threads and in viz stayed at 10–25 ms/s in every variant, and paced frame rates
didn't separate them.

| Image         | Renderer    | Naive   | Cached  | Two canvases | First alone | Stars alone |
| ------------- | ----------- | ------- | ------- | ------------ | ----------- | ----------- |
| land-april    | M1 Pro      | 9.0–9.1 | 7.3–7.7 | 5.7–6.7      | 0.7–1.5     | 4.9–6.1     |
| land-april    | SwiftShader | 128–163 | 191–210 | 35–42        | 2.9–3.5     | 32–37       |
| coast-august  | M1 Pro      | 17–18   | 7.7–8.9 | 6.3–6.8      | 1.2–1.4     | 5.0–6.6     |
| coast-august  | SwiftShader | 188–205 | 172–212 | 35–42        | 3.4–4.6     | 32–34       |
| coast-july    | M1 Pro      | 5.3–5.8 | 5.2–5.6 | 15           | 4.9–5.4     | 5.1–5.3     |
| coast-july    | SwiftShader | 32–36   | 31–34   | 79–162       | 28–43       | 28–45       |
| land-december | M1 Pro      | 6.8–6.9 | 6.8–7.2 | 15–18        | 6.7–6.9     | 5.1–5.5     |
| land-december | SwiftShader | 48–59   | 44–54   | 89–128       | 48–57       | 32–38       |

- Mist with stars: two canvases cost about what the two effects cost alone, the lowest on
  both renderers, and a quarter of naive under SwiftShader. Cached is no better on the M1
  and no better than naive under SwiftShader, where copying the full canvas costs about as
  much as drawing the mist at full density.
- Two effects at the same rate and resolution (fireflies or aurora with stars): one canvas
  costs about the first effect alone, and a second canvas doubles the cost, since each
  full-density canvas carries a floor of about 0.2 ms a frame on the M1 and 1.2 ms under
  SwiftShader, however few its items.
- The moved texture wasn't needed: with two canvases the mist adds under 1 GPU ms/s on the
  M1 and about 5 under SwiftShader.

Chosen (Kait, 2026-10-01): effects at the same resolution share a canvas and draw naively,
at the faster one's frame rate; an effect at a coarser resolution, the mist, gets a canvas of
its own under the other, at its own rate (`weatherCanvases` in
`src/lib/scene/weather-renderer.ts`). The measured pairs share a frame rate too. Grouping by
resolution alone also puts the stars on the 60 fps canvas of the midges, leaves, and
squalls: there they add nothing on the M1 and at most 0.3 ms a frame under SwiftShader,
against the 1.2 ms floor of a canvas of their own.

### Pairs in the app (2026-10-01)

Each new case, as `IMAGE_WEATHER` has it, on the timer layout at pixel ratio 1.5 with
`--window=3000`: the pair, its first effect alone (`--variant=alone`), and its stars alone
(`--variant=also`). Uncapped mean GPU ms per frame, then paced GPU ms per second. Land
November and coast March are stars alone.

| Case               | M1 pair    | M1 first   | M1 stars  | SwiftShader pair | SwiftShader first | SwiftShader stars |
| ------------------ | ---------- | ---------- | --------- | ---------------- | ----------------- | ----------------- |
| land-april-dark    | 0.28, 5.7  | 0.09, 0.7  | 0.22, 5.1 | 1.48, 36         | 0.34, 2.4         | 1.26, 36          |
| land-may-dark      | 0.29, 6.1  | 0.12, 0.9  | 0.23, 5.0 | 1.41, 40         | 0.32, 3.1         | 1.37, 41          |
| land-july-dark     | 0.23, 10.6 | 0.22, 10.6 | 0.22, 5.0 | 1.39, 85         | 1.21, 54          | 1.57, 31          |
| land-october-dark  | 0.22, 10.1 | 0.22, 10.2 | 0.22, 5.0 | 1.33, 64         | 1.23, 68          | 1.24, 32          |
| land-november-dark | 0.21, 5.4  |            |           | 1.30, 34         |                   |                   |
| land-december-dark | 0.32, 8.0  | 0.32, 9.1  | 0.22, 5.4 | 2.84, 72         | 2.81, 77          | 1.35, 39          |
| coast-march-dark   | 0.21, 5.0  |            |           | 1.29, 34         |                   |                   |
| coast-july-dark    | 0.21, 5.6  | 0.21, 5.2  | 0.21, 5.4 | 1.35, 34         | 1.51, 28          | 1.38, 33          |
| coast-august-dark  | 0.32, 6.7  | 0.13, 1.3  | 0.22, 5.1 | 1.42, 35         | 0.35, 3.4         | 1.33, 114         |
| coast-october-dark | 0.22, 11.6 | 0.23, 12.3 | 0.22, 5.5 | 1.45, 75         | 1.51, 77          | 1.26, 33          |

Coast August's stars alone under SwiftShader (114) is one noisy window; its pair is 35.
Land December is re-timed with the aurora as Kait tuned it (2026-10-02, subtask 02): its
taller curtains and ragged tops cost the pair about 0.06 ms a frame more on the M1 than the
first version (0.26, 7.4), and under SwiftShader 72 GPU ms/s paced against 51, with its
uncapped mean (3.27 before) within the run-to-run noise of about 15%. Its dim patches are
worked out per vertex, which keeps two noise lookups out of the fragments. The stars cost no
more than a canvas's floor, and the aurora adds about 0.1 ms a frame on the M1 and 1.5 ms
under SwiftShader over it, so the shaders got no further rework past
task 069's design: integer hashes, `flat` varyings on the stars' points, `mediump`
fragments (the aurora's noise coordinate in `highp`, as the mist's), no per-item branches
in the fragment shaders, and the stars' points sized to their halo.

## Acceptance criteria

- [x] Variants measured as above, with the numbers and the chosen variant recorded here
- [x] An image's weather in a theme can name a second effect, in the app's `IMAGE_WEATHER` and
      the prototype's `scene.js`
- [x] Each effect keeps its own frame rate and resolution if the measurements call for it
      (the mist, on a canvas of its own)
- [x] The Weather hint names both effects ("mist and twinkling stars"), in every language
- [x] The weather bench tunes both effects of an image
- [x] Golden frames for a pair, and GPU time per frame for a pair against each effect alone
