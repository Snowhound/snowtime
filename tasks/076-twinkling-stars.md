# 076: Twinkling stars

Status: todo

Kait (2026-09-30): a new effect for the Baltic countryside's November night (`land-november`,
dark), "vilkuvad tähed". The photo already shows many stars. The effect adds about a dozen
more on top, at fixed points in the sky: each one's brightness changes a little all the time,
as the atmosphere makes real stars scintillate, and now and then it flashes brighter, as
glitter's specks do, without moving.

The number is a first guess; Kait and the agent tune the count, size, and strength together
in the weather bench against the photo. Start small and sparse (the weather's usual taste).

Open: the image's dark theme shows frost today. The renderer draws one effect per image, so
the stars either replace the frost or the renderer learns to draw two effects. Ask Kait which.

## Acceptance criteria

- [ ] A stars effect (or a glitter preset, if glitter's shimmer and glints do the job) with
      zones in the image's sky, tuned with Kait in the bench
- [ ] `IMAGE_WEATHER` gives it to `land-november` in the dark theme, with a Weather hint and
      its message in every language
- [ ] Golden frames added for the new case, and the effect's GPU time per frame recorded
