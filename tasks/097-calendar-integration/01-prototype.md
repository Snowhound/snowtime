# 097.01: Prototype

Status: done

Design every view of the calendar integration in static prototypes, and get them approved
before subtask 02 starts. The views decide more here than the mechanics: how planned events
sit beside logged time without crowding it, and how a user tells a planned event, a logged
one, and an entry apart at a glance.

Build on the latest calendar, `prototypes/copy-entries.html`, as a new
`prototypes/calendar-events.html`, and add the Settings section to `prototypes/settings.html`.
Follow `prototypes/README.md`: fictional data, local state, no network calls.

## Views

- **Week calendar.** Planned events as blocks distinct from entries (outline, hatch, or
  muted tint: try variants), in the calendar's color, or the series project's color once
  it has one. A logged event shows as one block with its entry, as in Toggl, not two
  stacked. Declined events, events shown as free, and all-day events each have a look,
  or are hidden; all-day events may sit in a strip above the grid. An event that overlaps
  the running timer or another entry shows the overlap.
- **Event popover.** Title, time, calendar, and series. Log (opens the entry popover filled
  in), Project for this series, and Don't auto-track this series. On a logged event, a link
  to its entry.
- **Logging an ongoing meeting.** It logs from its start to its scheduled end, ending after
  now, and the block shows it is under way.
- **Log meetings dialog.** Opened from the calendar's toolbar and the list view, with the
  range set to today. It lists the range's events with a checkbox each: started ones
  checked, upcoming, declined, free, and all-day ones unchecked, already logged ones shown
  but not selectable. Each row shows the project it will get. Changing the range lists
  older meetings. Up to 100 are logged in one save, which the dialog says when more are
  checked.
- **List view.** How the day's unlogged meetings reach the list: a line per day ("3
  meetings not logged"), the dialog, or both.
- **Status line.** "Logged 3 meetings" with Undo after the dialog and after auto-track,
  and what it says when one overlaps the running timer.
- **Settings, Calendars section.** Connect Google; the connected account with Disconnect;
  `reconnect` status; the account's calendars with Show and Auto-track switches, and the
  organization a calendar auto-tracks into when the user has several; the series rules
  with their projects, editable and removable.

## Fixtures

Fixture selector with: not connected; connected, no events; a typical week (standups as a
daily series, a weekly review, one-off meetings, a declined invitation, an unanswered one,
an all-day event, focus time, out of office); a meeting under way now; a day with
overlapping meetings; long titles; a second calendar; a reconnect needed.

## Acceptance criteria

- [x] `prototypes/calendar-events.html` shows the views above with the fixtures, in both
      themes and at phone width
- [x] `prototypes/settings.html` has the Calendars section in its states
- [x] Where the look is open, variants switch with `body[data-design]`
- [x] The checks in `prototypes/README.md` pass, and the README has an entry for the new
      prototype
- [x] The maintainer has approved a design, and its entry records the choices
