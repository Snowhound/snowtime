# 02: Aurora for countryside December

Status: done

Kait (2026-10-01): countryside December's night (`land-december`, dark) needs an aurora effect,
with the stars as well. The photo shows a faint green aurora low on the left, above the
treeline. The effect makes it move slowly, as an aurora's curtains shift and brighten, and
stays as subtle as the rest of the weather. It replaces the light snowfall the dark theme
shows today, which doesn't match a clear sky.

Prototype it the way `prototypes/stars.html` does the stars: over the photo, with sliders,
tuned with Kait before it moves to the app. A first version is in `stars.html` (2026-10-01):
four curtains along the photo's bands, on the left only, with sliders for brightness, height, rays, sway, pulses,
and a violet top.

The photo had an aurora painted in on the left, which the moving curtains can't follow freely.
Its version `03` night (2026-10-02, `design/backgrounds/baltic.md`) keeps only a faint glow in
the middle, under the cards, with a night with no aurora beside it in case the glow shows;
`stars.html` and `weather.html` switch between the two.

Kait's pick (2026-10-02), in `stars.html`'s defaults, the app, and `scene.js`: curtains a fifth
longer to the right, 1.4 times as tall, at brightness 0.95. Rays stay upright, as real ones
look, but tilt very slightly toward one point far above (convergence 0.3, at x 0.15), each
ends at its own height (ragged tops 0.5), and dim patches drift along the curtains (0.9, size
0.6), as a real aurora's curtains vary in brightness. Rays that bend and lean in groups their
own way were tried and dropped.

## Acceptance criteria

- [x] A prototype of the aurora over the land December photo, tuned with Kait
- [x] An aurora effect in the app, drawn with the stars through subtask 01, in place of the
      dark theme's snow
- [x] A Weather hint and its message in every language, golden frames, and the effect's GPU
      time per frame recorded (subtask 01, "Pairs in the app")
