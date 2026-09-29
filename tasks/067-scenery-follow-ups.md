# 067: Scenery follow-ups

Status: todo

What stays open after the scenery collections (tasks 062, 063, 065, and 066) merged. The
monthly images and their weather are done and approved; these are the checks and fixes that
wait on a release, a device, or new pictures.

## Images

The image work stays outside the repository, in
`C:\Users\kait\projects\personal\art\snowtime-backgrounds\065\`, and its `README.md`
("Follow-ups") has the details and Kait's notes. A replaced image follows task 065's
pipeline and gets the next version in its file name (`-03-`), then `baltic.md` records it and
`HORIZONS`, the bands, and the zones in `src/lib/scene/weather.ts` are measured again.

- Land September, October, and December: new light baselines from ChatGPT, as for land August,
  since the rowan berries, the October grass blades, and the straight spruce line look
  generated. The nights are Qwen edits of the chosen lights.
- Land November night: the stars the final added look unrealistic. Either a realistic November
  sky or far fewer stars.
- Land August: recompose from the ChatGPT baseline, with finer stubble and bales at the sides,
  then its night edit, re-measure its horizon (about 0.52) and mist band.

## Acceptance criteria

- [ ] Land September, October, and December have new light and dark images from the ChatGPT
      baselines
- [ ] Land November's night sky has realistic stars, or far fewer
- [ ] Land August is recomposed, with its horizon and mist band measured again
- [ ] Coast September's night fog (task 066) checked in motion by Kait
- [ ] `titleLight` measured at 5:1 or better over every Baltic final, light and dark, as task 065
      measured the task 062 images
- [ ] The weather checked by eye in Chrome at 60 and 120 Hz and in Safari (task 063). Safari
      limits `requestAnimationFrame` to 60 Hz on ProMotion screens by default. Include the mist
      at 10 fps and half resolution on coast November's night, its fastest drift.
- [ ] Once the collections release is promoted, a migration drops
      `user_settings.scene_season`, which the app no longer reads (task 062;
      `docs/migrations.md`)
