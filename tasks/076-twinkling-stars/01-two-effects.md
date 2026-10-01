# 01: Two effects at once

Status: todo

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

## Acceptance criteria

- [ ] Variants measured as above, with the numbers and the chosen variant recorded here
- [ ] An image's weather in a theme can name a second effect, in the app's `IMAGE_WEATHER` and
      the prototype's `scene.js`
- [ ] Each effect keeps its own frame rate and resolution if the measurements call for it
- [ ] The Weather hint names both effects ("mist and twinkling stars"), in every language
- [ ] The weather bench tunes both effects of an image
- [ ] Golden frames for a pair, and GPU time per frame for a pair against each effect alone
