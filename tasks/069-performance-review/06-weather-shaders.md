# 06: Weather shaders

Status: done

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

- [x] Each effect's shader reviewed against the list, with GPU time per frame before and
      after (weather bench), per effect
- [x] Golden frames unchanged within tolerance, or updated after Kait signed off the
      variant in the bench (the look-preserving rewrite matches all 75; the integer hash's
      frames updated after Kait's sign-off on 2026-09-30)
- [x] No per-pixel branch that depends on the item; uniform branches only where a `#define`
      would make the code harder to read
- [x] The shaders read as plainly as before or better, with comments where the math isn't
      obvious

## Findings (2026-09-30)

The effects' own draws are too small to matter on either renderer. Measured with a scratch
script that times 30 `drawAt` frames inside one GPU timer query (no photo, no glass, 1440 ×
900, pixel ratio 1.5), old and new shaders interleaved over 10 batches:

| Case                           | M1 Pro, ms per frame | SwiftShader, ms per frame |
| ------------------------------ | -------------------: | ------------------------: |
| Every point effect and rain    |          0.033–0.047 |                   1.0–1.6 |
| Mist (four presets)            |            0.10–0.15 |                   1.0–1.9 |
| Change, point effects and rain |         0.99 to 1.03 |      0.86 to 1.17 (noise) |

On the M1 a point effect costs about what clearing the canvas does, so the rewrite can't
move it. The paced bench under SwiftShader, with the photo and the glass, saturates the GPU
process (4,000 to 5,000 ms of CPU a second) and gives uncapped rates from 2 to 119 fps, so
it can't separate the effects at all.

What changed, all keeping the golden frames (75 of 75):

- Each program compiles with `#define`s for what its weather uses (`BAND`, `SHEAR`, `ZONES`
  with the zone count, `GATHER`, `FLUFF`, `FIREFLIES`). The shared head is split into the
  snippets an effect includes (wind, falling, zones), so each shader holds only its own code.
  `u_zoneCount` is gone.
- Every item's color, premultiplied, comes from the vertex shader, and so do the leaves'
  turn (`cos`, `sin`) and tumble, which the fragment shader worked out per pixel.
- No fragment shader branches on the item. Seeds blend fluff and pollen with a flat weight
  and only with `FLUFF`; the insects compute a firefly's shape only with `FIREFLIES`.
- Points use `flat` varyings. Rain and mist keep smooth ones: with `flat`, rain drew about
  10% slower on the M1 (0.042 to 0.047 ms, 15 rounds of 50), since ANGLE on Metal emulates
  WebGL's provoking vertex for triangles. Smooth, it matched the old cost exactly. Rain's
  width varying is gone too: the quad's across coordinate is in half-widths.
- The mist writes zero where it's too faint to show instead of discarding: on the M1, 0.89,
  0.92, 0.73, and 1.00 times the time for the four mists; within noise on SwiftShader.
- Leaf points are 10% smaller, since a leaf's tips reach only 0.87 of the 1.05 the point
  spanned: 19% fewer pixels, with the leaves the same size.

Found on the way: mist without zones never kept to its `band`. `prepare` always passes at
least one zone (glitter's default, the ground below the horizon), so the old `u_zoneCount >
.5` test was always true, in the prototype too. The band mists (coast November, land March,
May, August, and September at night) lie between the horizon and the screen's foot, and
that's the look Kait approved. Compared in the bench on 2026-09-30, Kait kept it for four
of them and chose the band for land March, whose mist now lies on the bog's water. Its band
became its zone, which draws the same frames as the band did, and the mists' bands are gone.
The "mist band" golden case went with them, and coast April's merged into "mist zones".

## Integer hash (signed off 2026-09-30)

An integer hash (lowbias32, from `uint(gl_VertexID)`) replaces the `fract(sin())` hashes and
`columnHash`, and the mist's noise uses it too. It gives every item new random values, so all
75 golden frames changed, though density and spread look the same on a contact sheet. It's no
faster (0.99 to 1.03 on the M1); the gain is one exact hash instead of three, with no `sin`
hash breaking down at large arguments or in `mediump`. Kait compared it in the bench beside
the old shaders and signed it off, and the golden frames were updated.

## Checked and left as is

- Polynomial falloffs in place of `exp`: the closest fits, such as `(1 - 0.6d²)^8` for the
  firefly's halo, are off by 2 to 5% of full alpha, past the goldens' 3%, and cost three or
  four multiplies against `exp`'s one special-function instruction.
- Tighter points for the other effects: snow, glitter, seeds, fireflies, and midges already
  fill the circle their point holds; only the square's corners are left, which a point
  can't avoid.
- Precision: the vertex shaders stay `highp` (positions, time), the fragment shaders
  `mediump`, with `highp` only for the mist's noise coordinate and the integer hash, whose
  `uint` would otherwise be `mediump` in a fragment shader.
- A uniform block for the tuning: every uniform already uploads once per start or resize,
  and a frame sends only `u_time`. A block would add a buffer and layout code for nothing.

## Follow-up

- Twinkling stars for the Baltic countryside's November night: task 076.
