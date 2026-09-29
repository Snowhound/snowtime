# 03: Scene and taglines

Status: todo

## Acceptance criteria

- [ ] Weather presets hold only values that two or more images share; each image's
      resolved weather is unchanged, checked by comparing `weatherFor` for every image
      and theme before and after
- [ ] Per-image weather data sits in one table, and `PHOTO_VERSIONS` lists the minority
      version
- [ ] Weather colors are data, not functions
- [ ] The history comments at `weather.ts:703` and `weather.ts:875` are gone
- [ ] The pinned taglines test snapshots set ids, not every line's text
- [ ] The scenery picker and the app icon dialog share one radio group
- [ ] `season-tagline.tsx` works out its lines once per change
