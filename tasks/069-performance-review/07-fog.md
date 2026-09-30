# 07: Fog

Status: done

The mist is the most expensive effect. Each bank is a large quad that computes value noise
per pixel, and the banks overlap, so a pixel can be shaded several times. Task 065 already
halved its resolution and runs it at 10 fps. The goal is fog that reads the same in each
scene for much less work. It doesn't have to match pixel for pixel: a faster approach that
looks somewhat different, or a new idea, goes to Kait as a variant beside the current fog in
the weather bench, with its numbers, to sign off (as in subtask 06).

What makes it cheap is that fog is soft and slow: banks drift at most about 3 px a second and
have no detail finer than tens of pixels.

## Approaches to compare

Start with the cheapest to try; stop when the numbers are good enough.

1. **Lower resolution.** Fog has no fine detail, so a quarter of a CSS pixel per backing pixel
   may look the same as a half, with a quarter of the pixels. One number in `EFFECTS`.
2. **Baked noise.** Generate a small tileable noise texture once at startup (for example
   128 × 128, one channel) and sample it at two scales, scrolled with the wind. A texture
   read replaces the per-pixel hashes and interpolation.
3. **One pass, no overdraw.** Draw one full-screen triangle that evaluates every bank for
   the pixel, instead of one quad per bank blended over the others. The bank count is small
   and fixed per preset, so the loop unrolls.
4. **Separable fog.** A bank is wide and low: its density is roughly a vertical profile times
   a slow change across. Put the across part in a one-row texture updated each fog frame, so
   a pixel does one read and a multiply.
5. **Move the fog on the compositor.** Render the fog once into a texture wider than the
   screen and scroll it with a CSS transform, redrawing only at a low rate for the banks'
   slow thinning. Nearly no GPU work per frame, but the most code; only if 1 to 4 fall short.

## Acceptance criteria

- [x] GPU time for the mist presets before and after, on the M1 (SwiftShader was measured
      in subtask 06, where the mist costs about what the other effects do)
- [x] Golden frames for the mist presets unchanged within tolerance, or Kait signed off the
      new fog (8 of 9 match; Kait agreed to the quarter on 2026-09-30)
- [x] `docs/architecture/scene.md` ("Weather") describes how the fog is drawn and why

## Findings (2026-09-30)

Subtask 06's numbers cut this subtask down to approach 1, with Kait's agreement. On the M1 the
mist cost 0.10 to 0.18 ms a frame against 0.04 ms for the other effects, at 10 fps, so about
1.5 ms of GPU time a second. Under SwiftShader it costs about what snow and rain do. Since
subtask 05's pre-blurred glass, the mist's frames already run near the no-glass floor.
Approaches 2 to 5 would save a fraction of 0.1 ms ten times a second, for real code, under
the task's 5% rule.

A quarter of a backing pixel per CSS pixel in place of a half (`resolution` in `EFFECTS`),
GPU time per frame on the M1 at 1440 × 900, pixel ratio 1.5, median of 10 batches of 30
draws:

| Case (dark)     | Half, ms | Quarter, ms |
| --------------- | -------: | ----------: |
| Land September  |    0.178 |       0.090 |
| Coast September |    0.166 |       0.057 |
| Coast April     |    0.093 |       0.030 |
| Coast August    |    0.142 |       0.066 |

Over the photos, frames at 20 seconds are the same pixel for pixel within 2%. Of the nine
golden frames, only coast August's first differs past the tolerance (22 pixels, by up to 10
of 255): the bright end of the thin bank along the island's foot is a little softer. The
case's three frames were updated.

## Checked and left as is

- Baked noise, one pass for all banks, separable fog, and fog moved to the compositor
  (approaches 2 to 5): not worth their code for what the mist costs, as above.
