# 03: Scene and taglines

Status: done

## Acceptance criteria

- [x] Weather presets hold only values that two or more images share; each image's
      resolved weather is unchanged, checked by comparing `weatherFor` for every image
      and theme before and after
- [x] Per-image weather data sits in one table, and `PHOTO_VERSIONS` lists the minority
      version
- [x] Weather colors are data, not functions
- [x] The history comments at `weather.ts:703` and `weather.ts:875` are gone
- [ ] ~~The pinned taglines test snapshots set ids, not every line's text~~ Decided against:
      the text snapshot stays, because its diff shows every wording change per day, which
      reviewing copy needs
- [x] The scenery picker and the app icon dialog share one radio group
- [x] `season-tagline.tsx` works out its lines once per change
- [x] The theme not on screen loads its photo only when a switch is likely

## Findings

- A throwaway script in the gitignored `temp/` dumped every image's resolved weather in both
  themes, with the renderer's defaults filled in, its colors on each page the theme reaches,
  and its photo URLs. The dump was identical before and after.
- `glitter-day` and `frost-day` are gone, and `glitter-night` holds the three moonlit images'
  shared values. `flurries` and `squall` keep no tuning; land January takes the flurries'
  amount, size, and fall.
- `IMAGE_WEATHER` holds each image's horizon, shared zones, and weather, with `both` for an
  image whose light and dark weather match. `PHOTO_VERSIONS` stays in `scene.ts`, next to
  `photoUrl`, so `scene.ts` doesn't import the shaders; it lists the nine images at version 1.
- Colors are `{ dark, image, plain }` pairs; an override names only the pages it changes.
  `weatherColors` picks the pair when the weather starts, and the renderer uploads it with the
  other per-start uniforms, so a frame uploads only the time.
- Kobalte's RadioGroup uses native radio inputs and moves linearly with every arrow key, so it
  doesn't fit the app icon grid. `src/components/radio-group.tsx` takes the hand-rolled
  version, with `grid` for Up and Down by row.
- The other theme's 1920 px photo (about 200 KB) loads once `expectThemeSwitch` runs: on
  hovering or focusing either Appearance button, or when Settings' Preferences card mounts.
- Colors as data take more lines than the ternaries did, so `src/lib/scene` grew by 2 lines, to
  2,321; `src/` shrank by 5 lines overall.
