# 05: Timer layouts and View popover

Status: todo

The two other timer layouts, kept as user-selectable options, and the popover that
switches them. Prototype: `prototypes/timer.html`.

## Acceptance criteria

- [ ] Focus layout: large clock, "continue recent" chips, and a compact day list
- [ ] Table layout with day subtotal rows, scrolling horizontally inside its container on
      narrow screens
- [ ] Summary panel (today, this week, per-project bars, running timer included), shown
      when `show_summary` is on
- [ ] View popover: layout, theme, and summary, saved through `updateSettings`, with a
      link to Settings
