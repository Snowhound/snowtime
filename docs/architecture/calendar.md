# Calendar integration

A user connects a Google account, picks which of its calendars to show, and logs their
events as time entries (task 097). The product decisions, the provider-neutral design, the
data model, and why calendar access is its own connection are in the
[task README](../../tasks/097-calendar-integration/README.md#decisions). This page records
how the connection and logging work (subtask 02, 2026-11-03).

## Connecting

`src/server/calendar/` holds the domain. Its routes and schemas name no provider. Each
provider's adapter (`providers/google.server.ts`) is the only code that knows its endpoints
and field names.

- The flow is OAuth 2.0 with PKCE. `connectCalendar` answers the consent URL with a state
  that carries the user, the PKCE verifier, the page to return to, and an expiry 10 minutes
  out, sealed with AES-GCM. The server stores nothing until the user comes back.
- Google redirects to the app page `/calendar/callback`, not to the API. The page POSTs the
  code and state to `finishCalendarConnection`, which exchanges the code. This keeps the
  rule that a GET only reads (`README.md`, "Application rules"). The rule refuses a state
  sealed for another user or past its expiry with `calendar_state_invalid`. If the user
  unticked a scope on the consent page, the rule revokes the token and refuses with
  `calendar_scopes_missing`.
- The account is the primary calendar: its id is the account's address, so the two calendar
  scopes are enough and Snowtime doesn't ask for the user's profile. A new connection shows
  only the primary calendar. Connecting the same account again keeps the user's choices and
  adds or removes calendars to match the provider.
- Disconnecting revokes the refresh token at the provider when it can, and deletes the
  connection and its sources whether or not the revoke succeeds.

## Tokens

`tokens.server.ts` seals tokens and states with AES-GCM under a key that HKDF-SHA256 derives
from `BETTER_AUTH_SECRET`, with a separate key per purpose. No API answer carries a token.
Rotating the secret makes stored tokens unreadable, so users reconnect.

Before a read, the server refreshes an access token that expires within 60 seconds. When
the provider refuses the refresh, the connection's status becomes `reconnect`. Its events
are then left out, and Settings and the timer say to reconnect. A provider that doesn't
answer is `503 calendar_provider_unavailable`, and the connection stays as it is.

## Reading events

`listCalendarEvents` is a `POST` marked `reads`, for a range of at most 93 days. It answers
the shown calendars' events, each connection's status, and `logs`: the user's entries in
any organization, deleted ones included, that carry one of the events' keys. The browser
caches the answer per organization and range for a minute (`calendarEventsQuery`) and
reads it again after a log or an Undo.

An event is logged here when a loaded entry carries its key, or when a log in this
organization does. The week calendar draws a logged event as its entry only. The list
shows a started meeting that isn't logged, or whose entry was deleted, as a row among its
day's entries (Bar and Focus layouts; Table shows none).

## Logging

Logging is `createEntries`, whose entries each carry their own description, ticket,
project, and `calendarEvent` key, so one save is one Undo for up to 100 meetings. Inside the
transaction, `claimCalendarEvents` refuses a key used twice in the call or already on a live
entry of the user, in any organization, with `409 calendar_event_logged`. A key on a deleted
entry moves to the new one, because the user asked to log the event again. The partial
unique index on (`user_id`, `calendar_event`) settles a race between two tabs: the second
insert fails, and the rule answers the same 409.

A meeting's project starts as that of the user's latest loaded entry with the same
description, if that project is active; the popover and the dialog let the user change it.
A meeting under way logs to its scheduled end, or to now with **Log until now** when it
ended early. Undo sits where the user acted: on the new entry's row after a log from a
meeting's row or popover in the list, until the next change; and in the calendar's status
line, also after the Log meetings dialog, which only the calendar's toolbar opens. Deleting
a logged meeting's entry, or undoing its log, reads the events again, so the meeting shows
to log anew.

An all-day event logs only on request, as 8 hours from 09:00 on each day it covers. An
event that covers several days skips weekends and the user's public holidays. Each day's
key is the event's key plus `:<date>`, so each day is logged once.

Google keeps a day off as an out-of-office event from midnight to midnight, not as an
all-day event, so the calendar labels such a span "All day" rather than "00:00–00:00".
