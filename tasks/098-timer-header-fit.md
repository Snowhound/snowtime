# 098: Fit the Timer page header

Status: todo

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

## Acceptance criteria

- [ ] At 1440 px the Timer header shows the title, the tagline in the middle, and the
      actions on one row, as other pages do, with a calendar connected
- [ ] At 390 px nothing scrolls sideways, and every action is still reachable
- [ ] The chosen place for Log meetings is approved in a prototype first
