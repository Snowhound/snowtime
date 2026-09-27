# 060: Taglines about the user's timesheet

Status: todo

The tagline picks its set from the date and season only (`src/lib/scene/seasons.ts`,
`docs/architecture.md`, "Tagline"). Add sets that react to the user's own timesheet: a timer
left running too long, gaps in recent days, and grudging praise when everything is in. The
tone stays never satisfied: praise always ends in a demand. Add sets for dates the calendar
doesn't cover yet. With this many sets, move them out of the Paraglide messages into a
tagline catalogue.

A timer left running isn't stopped or flagged today. The server caps the entry at
`MAX_ENTRY_HOURS` (24) when someone stops it, so a timer forgotten overnight saves about
14 hours without a warning.

Decided on 2026-09-27:

- A working day counts as filled at 6 hours or more. The threshold is lax on purpose: the
  taglines are jokes and mustn't nag over a short day.
- Weekends and public holidays never count as gaps. Estonian holidays come from
  riigipühad.ee, US holidays from rules, and other countries count weekends only.
- The holidays follow the user's country, not their language. A Country setting defaults to
  a guess from the time zone.
- 1–2 empty working days in a row count as missing. 3 or more count as an absence, which
  gets a welcome back instead of a gap.
- Taglines move to a catalogue in `src/lib/taglines/`. The season sets stay in
  `messages/`, as the intro's lines and the tagline's fallback.
- The intro and the tagline pick separately. The intro plays about four times a year and
  opens the season, so it shows only the season's sets, never a date range's or one about
  the user's timesheet. On the visit where the intro plays, the tagline repeats the
  intro's set, so the page picks up what the user just watched; on other visits it picks
  its own.

Subtasks, in order:

1. `01-tagline-catalogue.md`: move the sets out of the messages
2. `02-holidays.md`: working days for Estonia and the US
3. `03-country-setting.md`: the Country setting
4. `04-timesheet-taglines.md`: the fill summary and the behaviour sets
5. `05-more-dates.md`: sets for uncovered dates

## Acceptance criteria

- [ ] The subtasks are done
- [ ] `docs/architecture.md`, "Tagline", records the catalogue, the order sets are picked
      in, and the fill rules
- [ ] `docs/product.md` mentions the Country setting and what it affects
