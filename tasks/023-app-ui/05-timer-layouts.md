# 05: Timer layouts and View popover

Status: done

The two other timer layouts, kept as user-selectable options, and the popover that
switches them. Prototype: `prototypes/timer.html`.

## Acceptance criteria

- [x] Focus layout: large clock, "continue recent" chips, and a compact day list
- [x] Table layout with day subtotal rows, scrolling horizontally inside its container on
      narrow screens
- [x] Summary panel (today, this week, per-project bars, running timer included), shown
      when `show_summary` is on
- [x] View popover: layout, theme, and summary, saved through `updateSettings`, with a
      link to Settings
- [x] The end of the entry list: "Show earlier entries" shows only while the user has
      earlier time (`getFirstEntryStart`); after the earliest entry, a line says so, with
      the date and the total

The Table layout edits entries in the dialog, like the other layouts. Task 030 moves all
three layouts to inline editing in the row.
