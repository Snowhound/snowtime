# 098: Fit the Timer page header

Status: done

On other pages the header holds the title on the left, the tagline in the middle, and the
actions on the right. On the Timer page with a calendar connected (task 097.02), the
actions are List | Calendar, Add entry, Log meetings, and View settings. They no longer fit
beside the tagline, so the tagline wraps under the title at desktop widths. Below 640 px,
Add entry and Log meetings already show only their icons to fit.

## Initial ideas

- Log meetings may not need a full button: an icon button with a tooltip, a place in the
  list instead of the header, or an item in another menu.
- Fitting every action at every width by shrinking them is unlikely to hold up; decide
  which actions the header keeps first.

## Outcome

Approved on 2026-11-05 in [timer-header.html](../prototypes/timer-header.html), design A:
the title row keeps Add entry and View settings, and List | Calendar moves under the timer
bar, above what it switches, with Log meetings at the other end of that row in List view.
Calendar view keeps Log meetings in its toolbar. The row sits 8 px closer to the entries
than the timer bar does, so compact rows tighten it too: 24 px above it and 16 px below, or
16 and 8 px with compact rows.
Icon buttons alone didn't fit: the view switch's labels crowd the tagline even without Log
meetings.

Checked on 2026-11-05 in Chrome against the dev app as Max Member, at 1440 and 390 px. The
local database has no calendar connection, so a copy of the Log meetings button was put in
the row to check the connected layout.

## Acceptance criteria

- [x] At 1440 px the Timer header shows the title, the tagline in the middle, and the
      actions on one row, as other pages do, with a calendar connected
- [x] At 390 px nothing scrolls sideways, and every action is still reachable
- [x] The chosen place for Log meetings is approved in a prototype first
