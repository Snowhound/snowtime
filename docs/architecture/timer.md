# Timer and settings

## Timer calendar

The Timer page shows the user's entries as a list by day or as a week calendar
(`prototypes/calendar.html`, task 069). The calendar replaces the entry list and the summary;
the timer bar stays. Its code is in `src/features/timer/calendar/`, with the time math in
`week-grid.ts`.

- Settings: `timer_view` (`list` or `calendar`, default `list`) is the header's List | Calendar
  switch, so the page opens the way the user left it. `calendar_weekend` (default off) is the
  toolbar's Weekend toggle; a week with weekend time shows the weekend anyway. Show summary
  applies to the list only, so the View popover hides it in Calendar view.
- Data: the calendar loads each shown week with `listEntries`, from the week's first day to
  the next week's in the user's zone and week start, which is well within its 93-day limit.
  The route's loader loads the current week when the view is Calendar. The running entry
  comes from the running timer's cache, which the timer bar edits.
- Positions are wall-clock minutes from the day's midnight, so the hour lines stay right on
  the days clocks change. An entry that crosses midnight has a piece on each day.
- Mutations: the calendar uses the list's `createEntry`, `updateEntry`, and `deleteEntry`
  mutations and their optimistic updates (`src/features/timer/queries.ts`). A drag or an
  Alt+arrow key is one `updateEntry`. The status line names each change with an Undo, which
  writes the old values back; undoing a delete creates the entry again under a new id,
  because a deleted row keeps its id. `updateEntry`'s optimistic update moves an entry
  between the cached ranges it leaves and enters, so an entry moved into another week shows
  there at once.
- The entry popover is the list's, with its fields and validation: no end in the future, and
  an end at or before the start means the next day. The calendar opens it beside the slot
  or the entry, with Delete for a stopped entry.

## Date and time fields

The app's date and time fields are its own components in `src/components/date-time/`, not
native `<input type="date">` and `<input type="time">` (task 035). Each browser draws the native
inputs its own way, so they looked out of place next to the other controls and differed between
Chrome, Firefox, and Safari. The prototypes keep the native inputs.

- `DatePicker` is a text input with a calendar button. The calendar opens in a popover (inline in
  the entry row's date popover) and follows the WAI-ARIA date picker dialog pattern, with keyboard
  navigation by day, week, month, and year. Weeks start on the user's week start.
- `TimeInput` is a text input with a clock button. The button opens a column of hours and one of
  minutes in 5-minute steps, as Firefox's picker does; a typed time can be any minute. ArrowUp and
  ArrowDown in the input move the hour or minute under the caret.
- Both popovers carry Kobalte's `data-kb-top-layer`, so the entry dialog's focus trap and
  `aria-hidden` leave them usable from the keyboard and by screen readers.
- Both show text in the UI language's format and read short forms back
  (`src/lib/date-input.ts`): `25.9` or `25092026` for a date in Estonian, and `930`, `9.30`, or
  `9:30pm` for a time. Their values stay ISO dates and `HH:MM` times, read in the user's zone as
  before. English follows `Intl`'s `en`, so dates are month first and times use AM and PM, as the
  rest of the app formats them.
- Mobile uses the same components, not the native wheels: the calendar works by touch, and a time
  field asks for the number pad in 24-hour locales.

## User settings

- All of a user's settings live in `user_settings`, one row per user, so they follow the
  user across devices: time zone, week start, language (`locale`), theme, timer layout,
  whether the summary shows, compact entry rows (`compact_rows`), the Wide page setting
  (`wide_timer`), the Timer page's view and the calendar's weekend (`timer_view`,
  `calendar_weekend`; see "Timer calendar"), the app icon
  (`app_icon`, the header mark and favicon), the seasonal scene (`scene_collection`,
  `scene_pin`, `scene_background`, `scene_strength`, `surfaces`, `scene_weather`, `scene_intro`,
  `scene_tagline`), and
  how durations, dates, and times show (`duration_format`, `date_format`, `time_format`),
  and the country whose working days count (`country`; see "Working days" in [data.md](data.md)).
  They default to 11:10, 30.09.2026, and 15:30 in every language. Exports keep the
  formats spreadsheets read, whatever the duration format.
- The server renders the theme class from the session user's settings, so the first
  paint uses the right theme with no flash. This is the main reason view settings moved
  here from `localStorage`. Signed-out pages (sign-in, invitations) use the theme, app
  icon, and scene settings kept on the device (`snowtime.settings` in `localStorage`,
  `src/lib/device-settings.ts`), which their Appearance menu changes. Signed in, the root
  copies the account's values there when their values change, not on every session refetch.
  The sign-in page opens as the last user left it. Signed-out changes stay on the device,
  and the account's settings apply at sign-in. A change on the device doesn't trigger the
  copy, so a tab that hasn't noticed a sign-out in another tab doesn't undo that tab's
  changes.
  - The server renders the setting as `data-theme` on `<html>`. A script in `<head>`
    applies the `dark` class from it before the body paints, because only the browser
    can resolve `system`. Signed out, there is no `data-theme`, and the script reads the
    device's theme instead. The script also follows later changes to the setting and to
    the system preference.
- The UI saves each field when it changes, so `updateSettings` takes a partial patch.
  The session query carries the settings, and `useUpdateSettings` in
  `src/lib/queries/settings.ts` updates it optimistically. A change therefore shows at once
  wherever the settings are read. A new language applies without a reload: the root
  passes it to Paraglide, which sets the cookie, and renders the page again.
- The app validates the text values (`src/server/settings/settings.schemas.ts`); their columns
  have no `CHECK`, so adding a value needs no table rebuild. The booleans (`show_summary`,
  `compact_rows`, `wide_timer`, `calendar_weekend`, and the scene's switches) keep the usual
  0/1 `CHECK`.
- Wide page (`wide_timer`, off by default) widens the Timer page from the header's width to
  88rem and puts the timer across the summary column, so rows have room for a Ticket column.
  Off, the page keeps the header's width and each row's chip sits at the end of its
  description. The Timer route is `wide` (its `staticData`), so the view sets its own width.
