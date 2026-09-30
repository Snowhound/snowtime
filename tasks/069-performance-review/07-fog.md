# 07: Fog

Status: todo

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

- [ ] GPU time for the mist presets (land and coast, day and night, including coast
      November's night drift) before and after, in the weather bench and under SwiftShader
- [ ] Golden frames for the mist presets unchanged within tolerance, or Kait signed off the
      new fog in motion in the bench
- [ ] `docs/architecture.md` ("Weather") describes how the fog is drawn and why
