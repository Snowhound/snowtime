# 097.02: Connect a calendar and log events

Status: done

A user connects a Google account in Settings, picks the calendars to show, sees their events
in the week calendar, and logs them: one from its popover, or many from the Log meetings
dialog, today's or an older range. Builds the approved design of subtask 01, and the
connection, sources, and entry key of the data model in the task's README.

## Initial ideas

- **Connect.** Settings starts the OAuth flow; its callback stores the connection and the
  account's calendars as sources, the primary one shown. The feature is hidden when
  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` aren't set, as Google sign-in is.
- **Tokens.** The server refreshes an expired access token before a call. A refresh the
  provider refuses sets the connection's status to `reconnect`, and Settings and the
  calendar say so; nothing else fails.
- **Reading events.** A filtered read, so a `POST` marked `reads`: a range of at most 93
  days, as `listEntries` allows, answered with `CalendarEvent`s plus the id of the entry
  each was logged as, if any. The calendar asks for each shown week; the dialog for its
  range.
- **Logging** is `createEntries` with each entry's `calendar_event`, so one save is one
  Undo. The server rejects a key the user has already logged. Logging an event whose entry
  was deleted moves the key to the new entry, since the user asked for it; auto-track
  never does (subtask 04).
- **An ongoing meeting** logs as a stopped entry from its start to its scheduled end, after
  now; entries may already end after now. Its popover also offers **Log until now**, for a
  meeting that ends early (decided 2026-11-05).
- **The dialog's defaults** follow the auto-track rules: started events checked; declined,
  free, all-day, out-of-office, working-location, and focus-time events unchecked but
  checkable.
- The description is the event title; a ticket key in it is found as in a typed
  description.
- **All-day events** log only on request, as a day: an 8 h entry from 09:00 on each day the
  event covers, leaving out weekends and holidays when it covers several, keyed by the
  event's key plus `:<date>`. The popover's **Log as a day** and the dialog's unchecked
  per-day rows do this; auto-track never does.
- **Out of office** greys its hours, or the whole day, behind the entries instead of drawing
  a block (approved prototype, 2026-11-03).

## Changes after the approved prototype

Decided while testing against a real calendar (2026-11-05); `prototypes/calendar-events.html`
still shows the earlier design.

- In the list, Undo after logging one meeting sits on the new entry's row until the next
  change.
- Log meetings opens only from the calendar's toolbar, where its range makes sense; the
  list logs a meeting from its row (task 098, 2026-11-05).
- A meeting under way logs to its scheduled end with plain **Log**; **Log until now**, on its
  row and in its popover, ends it now.
- A meeting whose entry was deleted shows again as a row in the list, as in the calendar.
- In the dialog, a logged meeting shows a check instead of a disabled checkbox.
- In the list, a meeting's times sit in the entries' Start and End columns, and its popover
  opens below the row.
- No **Edit first**: the popover only logs, and the entry is edited after, where it lands.
  Editing before logging let the entry move to another date or repeat while it still carried
  the meeting's key, and nothing else in the app edits a row that way.
- A meeting suggests the project of the latest loaded entry with its title (097.03 widens
  this to 90 days from the server).

## Acceptance criteria

- [x] A migration adds `calendar_connection`, `calendar_source`, and
      `time_entry.calendar_event` with its partial unique index, and the datamodel shows them
- [x] Settings connects and disconnects a Google account; disconnecting revokes the token
      and deletes the connection and its sources
- [x] Tokens are encrypted at rest, and no API answer carries one
- [x] Settings lists the account's calendars with a Show switch each
- [x] The week calendar shows the shown calendars' events as the approved design does,
      and a logged event as one block with its entry
- [x] An event's popover logs it at once with Undo
- [x] The Log meetings dialog logs the checked events of today or a chosen range in one
      `createEntries`, at most 100, with one Undo
- [x] An ongoing meeting logs ending at its scheduled end, or at now with Log until now
- [x] An all-day event logs as a day on request, and out of office greys its time
- [x] Logging an event already logged by the user is refused, also from a second tab
- [x] A refused refresh shows the reconnect state, and the rest of the page works
- [x] All Google-specific code is in the adapter; the routes, schemas, and tables name no
      provider
- [x] Tests cover the adapter's mapping (recurring, all-day, declined, free, out of office,
      cancelled, time zones), the logging rules, the unique key, and the token refresh,
      with Google's API mocked; conformance tests cover the new routes
- [x] Works locally with a Google OAuth client in testing mode and a test user
