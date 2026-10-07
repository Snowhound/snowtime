# 078: Copy durations

Status: done

Clicking a duration on the Timer page copies it to the clipboard, so the user can paste it
into a ticket's work log or an invoice. A per-user pattern in Settings sets the copied text.
For example, `Hh Mm Ss` copies two hours as `2h 0m 0s`. The copy comes from the raw
milliseconds, not from the shown text, so the Durations setting and the minute rounding of
totals don't affect it.

This task covers two durations on the Timer page: each entry's duration and each day's
total. The component is built so other durations can use it later (see "Later").

## The pattern

It works like a Google Sheets duration format, with uppercase letters as fields:

| Token     | Meaning                      | 2:05:09   | 11:15:10   |
| --------- | ---------------------------- | --------- | ---------- |
| `H`       | Hours, no padding            | `2`       | `11`       |
| `HH`      | Hours, at least two digits   | `02`      | `11`       |
| `M`, `MM` | Minutes, padded the same way | `5`, `05` | `15`, `15` |
| `S`, `SS` | Seconds, padded the same way | `9`, `09` | `10`, `10` |

- A run of the same letter sets the minimum number of digits: `HHH` gives `002`.
- Every other character is copied as is. With lowercase `h`, `m`, and `s` free, `Hh Mm Ss`
  gives `2h 5m 9s` and `11h 15m 10s`. A backslash copies the next character as is, so
  `H\H` gives `2H`.
- The largest field in the pattern holds the whole duration, as Sheets' `[h]` does.
  Hours never wrap at 24, and without `H`, `M:SS` copies 2:05:09 as `125:09`.
- Seconds are whole. The rest is dropped, like the shown `1:05:09`.
- The default pattern is `H:MM:SS`, which copies an entry's duration as the row shows it.
  It is a named constant, `DEFAULT_COPY_PATTERN`, shared by the database default, the
  client's fallback, and the settings field's reset.

## Plan

As built; `docs/architecture/timer.md`, "Copying durations", records the reasons.

1. **Formatter.** `src/lib/duration-pattern.ts`: `tokenizePattern` (cached), `formatDurationPattern`,
   `validDurationPattern` (1–40 characters, at least one field, shared by the server and the
   settings field), and `fieldsInWords` for the settings warning. Tested in
   `duration-pattern.test.ts`.
2. **Schema.** Two migrations add `copy_duration_pattern` (default `H:MM:SS`) and
   `copy_duration_control` (`text` or `button`, default `text`) to `user_settings`.
3. **Server.** `UpdateSettingsInput` validates both, and `settings.server.ts` returns them.
   `settings.test.ts` covers the defaults, updates, and rejected values.
4. **Hooks.** `useCopyPattern` and `useCopyControl` in `src/lib/display-format.ts` read the
   cached session, with the defaults when there is none.
5. **Component.** `src/components/copy-duration.tsx`: `CopyDuration` copies with
   `navigator.clipboard.writeText` and shows the bubble; with the button control, the
   text stays plain and a copy button sits beside it. A mouse click doesn't move focus to
   it. `CopyAnnouncer`, rendered once by `AppFrame`, reads each copy aloud.
6. **Timer page.** `EntryDuration` (list and table) and `DayTotal` (both day headers) use
   `CopyDuration`. The duration column widens in button mode.
7. **Settings.** Preferences > Copying durations (`copy-fields.tsx`): "Copy with", and the
   pattern field (`copy-pattern-field.tsx`) with colored fields, the in-word warning, a live
   preview, five examples including `H \Hours M \Minutes`, a key, and Reset.
8. **Messages, docs, and prototype.** English and Estonian messages;
   `docs/architecture/timer.md`; `prototypes/copy-durations.html` with its README entry.

## Decisions

Made in review on 2026-10-01 and 2026-10-02.

- Copies start from the raw milliseconds, never the shown text, so `duration_format` and
  the day totals' rounding don't change them.
- The pattern works like a Google Sheets duration format: uppercase `H`, `M`, and `S` are
  fields, a run sets the minimum digits, and the first field holds the whole duration.
- The first version covers the Timer page only: entry durations and day totals.
- Feedback is a bubble with the copied text. Swapping the text in place was rejected in
  `prototypes/copy-durations.html` because rows grew from 68 to 88 px at 390 px.
- The settings field colors the fields and warns about a field inside a word, rather than
  changing the syntax, and the examples include `H \Hours M \Minutes` to show the backslash.
- A second setting, `copy_duration_control`, offers a copy button beside the duration
  instead of a click on it. Both settings sit together under Preferences > Copying
  durations.
- In button mode at 1024 px with the summary panel, the row's description narrows from 67
  to 43 px. Accepted as it is.
- `CopyAnnouncer` lives in `AppFrame`, not the root layout or `TimerPage`; the reasons are
  in `docs/architecture/timer.md`, "Copying durations".
- A test with a real screen reader is left for later.

## Fixes found in review

- A clicked copy control kept focus, so an entry row stayed active, with its hover
  controls showing, after the pointer left. A mouse click no longer moves focus to it.
- The live region was created on the first copy, so that copy could go unannounced. It's
  now in the page from the start, and it sets its text with a timer, not an animation
  frame, which a hidden page never runs.
- The pattern cache grew with every draft typed in the settings field; it now starts over
  at 100 patterns.
- A timer-view test failed before 09:15 in the test zone, because today's 08:00 entry
  hadn't ended yet. It now pins the clock to noon.

## Acceptance criteria

- [x] Clicking an entry's duration or a day's total on the Timer page copies it, and a
      bubble briefly shows the copied text.
- [x] With the pattern `Hh Mm Ss`, 2:00:00 copies as `2h 0m 0s` and 11:15:10 as `11h 15m 10s`.
      With `HH:MM`, 9:05:30 copies as `09:05`. With `M:SS`, 2:05:09 copies as `125:09`.
- [x] Copies use the raw duration: a day total shown as `12h 5m` (rounded) copies its seconds
      when the pattern has `S`.
- [x] A new user copies with `H:MM:SS`. Settings shows the key, a live preview, the examples,
      and a reset to it.
- [x] The pattern is saved per user and follows the user to other devices. It applies at
      once in the tab that saved it; other tabs pick it up when they refetch the session,
      on focus once it's 30 s old. An invalid pattern isn't saved and shows an error.
      Checked 2026-10-02: a reload shows the saved pattern, and `hms` with Enter shows the
      error and leaves the saved one.
- [x] Keyboard users can copy with Enter or Space, and the live region gets the copied
      text. Checked 2026-10-02: Tab reaches the duration with a visible focus ring, and
      Enter and Space copy. A real screen reader is left for later (see "Later").
- [x] With the copy button setting, the button beside the duration copies it, and the
      duration column keeps every row's times aligned.
- [x] Rows and day headers don't change width or alignment: checked 2026-10-02 in the list
      and table, compact and not, at 1024 and 390 px, with both copy controls. No bubble is
      clipped and the page doesn't scroll sideways.
- [x] The migrations pass `db:drift`, and `bun run test` passes. The timer-view test that
      failed early in the morning now pins its clock to noon.

## Later

- Other durations: the summary panel, Projects, Reports, and the calendar. Four of them sit
  inside other controls (the running timer, the calendar's day totals, report totals that
  filter, and calendar blocks), which need their own way to copy, such as a copy icon shown
  on hover and focus.
- Decimal hours (`2.25`). A future `D` field could add them.
- Hear the copy announcement with VoiceOver and NVDA.
- Other tabs take up to a focus refetch to use a changed pattern. If that matters, update
  the session in every tab when settings change.
