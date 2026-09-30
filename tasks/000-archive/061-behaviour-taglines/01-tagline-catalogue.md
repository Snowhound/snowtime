# 01: Tagline catalogue

Status: done

Dated, range, and period sets are Paraglide messages that must exist in every language, but
the sets have stopped being translations of each other: school and Santa differ by
language, and some sets exist in one language only. Estonian lines read better written for
Estonian than translated. Move these sets to a catalogue in which each set holds the lines
for each language it has.

Proposed shape, one entry per set:

```ts
{ id: 'halloween', when: days('10-31'), lines: { en: [..., ..., ...], et: [...] } }
```

`when` is a date rule, a date range, a period, or a behaviour trigger (subtask 04). A set
with no lines in the user's language doesn't show. Lines can hold placeholders such as
`{hours}`.

The same change separates the intro from the tagline (README, "Decided"). Today
`seasonLines` gives both the season's sets and the date ranges' in turn. The intro keeps
only the season's sets; the ranges (July holidays, school, elves) become tagline-only. The
browser decides whether the intro is due (`introDue` in `src/lib/scene/intro.ts`), after
the server has rendered the tagline, so the tagline switches to the intro's set only when
it plays. The page is hidden under the intro then, so the switch isn't seen.

## Acceptance criteria

- [x] Dated, range, and period sets live in `src/lib/taglines/`, and their messages are gone
      from `messages/en.json` and `messages/et.json`
- [x] The four seasons' sets and their alternates stay Paraglide messages
- [x] On visits without the intro, the shown taglines are unchanged for every date in both
      languages
- [x] The intro shows only the season's sets, in turn by UTC day, and never a range's set
- [x] On the visit where the intro plays, the tagline shows the intro's set; a test covers it
- [x] `docs/architecture/taglines.md`, replaces "the intro and the tagline show the same
      set" with the new rule and its reason
- [x] A test checks that each set has three lines (two for period sets) in each language it
      has, that ids are unique, and that placeholders match between languages
- [x] A page loads only its own language's lines, or the catalogue adds less than 5 KB
      gzipped to the client bundle

## Bundle

Measured with `bun run build`, each `.output/public/assets/*.js` file gzipped at level 9, on
2026-09-27:

| Build  | Files | Raw         | Gzipped   |
| ------ | ----- | ----------- | --------- |
| Before | 60    | 1,006,412 B | 331,510 B |
| After  | 60    | 1,005,523 B | 332,299 B |
| Change |       | −889 B      | +789 B    |

Both languages' lines load on every page, well under the 5 KB limit. The tagline messages were
in the shared `session` chunk; the catalogue is in the tagline's own chunk (`season-tagline-*.js`,
3.8 KB gzipped with the component and the pick); the gzipped total grows slightly because
that chunk compresses on its own.
