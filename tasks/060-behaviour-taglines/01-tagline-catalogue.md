# 01: Tagline catalogue

Status: todo

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

## Acceptance criteria

- [ ] Dated, range, and period sets live in `src/lib/taglines/`, and their messages are gone
      from `messages/en.json` and `messages/et.json`
- [ ] The four seasons' sets and their alternates stay Paraglide messages
- [ ] The shown taglines are unchanged for every date in both languages
- [ ] A test checks that each set has three lines (two for period sets) in each language it
      has, that ids are unique, and that placeholders match between languages
- [ ] A page loads only its own language's lines, or the catalogue adds less than 5 KB
      gzipped to the client bundle
