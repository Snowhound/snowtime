# 06: Weather shaders

Status: todo

The effects in `src/lib/scene/weather.ts` work and look right, but they were written fast.
Rework them so a graphics programmer would read them without wincing: each shader short and
specific, the right precision and types, no divergent branches, no work done per pixel that
could be done per item.

An effect doesn't have to look exactly as it does now. What each scene should roughly look
like is known and approved (`prototypes/README.md`, "Weather by image"), and a known trick
that is much faster but looks a bit different is welcome, as are new ideas. Show such a
variant to Kait beside the current one in the weather bench (a toggle between the two, same
preset and time) with its numbers; Kait signs it off before it replaces the old one. A
change meant to keep the look must keep the golden frames (subtask 01) within tolerance.

Keep the design, which is already the right one: stateless items whose position is a
function of `gl_VertexID` and time, one draw call a frame, no buffers. Vertex work is small
(at most about 900 items); the cost is in the pixels, so the fragment shaders and the point
sizes matter most.

## Candidates to check

- **Specialize instead of branching on uniforms.** Features that a preset turns off (shear,
  zones, gather, band) are runtime `if`s on uniforms today. Uniform branches are cheap, but
  compiling each preset's program with `#define`s for what it uses drops the dead code and
  the uniforms. Only the variants that `IMAGE_WEATHER` uses get compiled, lazily as now.
- **No divergent branches.** Fireflies and insects, and seeds and pollen, choose their shape
  per item in the fragment shader (`if (v_kind > .5)`). Draw each kind as its own range with
  its own program, or blend the two shapes with `mix` where both are cheap.
- **Integer hashes.** `hash()` is `fract(sin(x) * big)`, which is slow on some GPUs and
  imprecise in mediump and at large arguments (`columnHash` already had to replace it once).
  Use one integer hash, such as PCG or lowbias32, from `uint(gl_VertexID)` throughout.
- **Per-item work in the vertex shader.** Leaves compute `cos` and `sin` of their angle per
  pixel; compute them once per item and pass them as `flat` varyings. Mark every per-item
  varying `flat`.
- **Cheaper falloffs.** Replace `exp(-d*d*k)` and `pow` in the fragment shaders with
  polynomials such as `(1 - d²)^n` where the golden frames show no difference.
- **Tight points.** A point sprite shades its whole square; a firefly's halo or a snowflake's
  soft edge may leave most of it transparent. Size points to what they draw.
- **Precision.** `highp` only where the value needs it (time, positions); `mediump` for colors
  and shapes. Check on a mobile GPU or with ANGLE's precision emulation.
- **Uniforms.** Tuning values that don't change during a run could live in one uniform block,
  uploaded once. Only worth it if it makes the code simpler.
- **`discard`.** The mist discards faint pixels to skip its noise. Check whether writing zero
  is as cheap on tiled GPUs, where `discard` can cost more than it saves. Subtask 07 may
  replace this code anyway.

## Acceptance criteria

- [ ] Each effect's shader reviewed against the list, with GPU time per frame before and
      after (weather bench), per effect
- [ ] Golden frames unchanged within tolerance, or updated after Kait signed off the
      variant in the bench
- [ ] No per-pixel branch that depends on the item; uniform branches only where a `#define`
      would make the code harder to read
- [ ] The shaders read as plainly as before or better, with comments where the math isn't
      obvious
