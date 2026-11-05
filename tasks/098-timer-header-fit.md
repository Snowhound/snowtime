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

Decided on 2026-11-05. Log meetings left the header: it opens only from the calendar's
toolbar, where its range makes sense, and the list logs a meeting from its row. The header
is back to List | Calendar, Add entry, and View settings, with their labels, as before the
calendar. A new setting, Compact buttons (`compact_buttons`, off by default, in the View
popover and Settings), shows only their icons, named by tooltips; View settings has a
tooltip too.

[timer-header.html](../prototypes/timer-header.html) compared three designs. A, the view
switch on a row above the entries, was built and then dropped: the extra row cost more than
it gained. C, icons in one row, became the setting.

With labels, a long tagline still drops under the title at 1440 px, as it did before the
calendar: "Your timer gave up after 24 hours. It's more committed than you." does. Compact
buttons leaves it about 180 px of room.

Checked on 2026-11-05 in Chrome against the dev app as Max Member, at 1440 and 390 px, with
and without Compact buttons.

## Acceptance criteria

- [x] At 1440 px the Timer header shows the title, the tagline in the middle, and the
      actions on one row, as other pages do, with a calendar connected
- [x] At 390 px nothing scrolls sideways, and every action is still reachable
- [x] The chosen place for Log meetings is approved in a prototype first
