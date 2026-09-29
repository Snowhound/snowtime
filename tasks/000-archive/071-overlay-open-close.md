# 071: Dialogs and popovers fade in and out

Status: done

Dialogs and popovers should open and close with a fade, in place, instead of moving. Two
things move today (seen on 2026-09-29):

- Dialogs slide in from and out to the top left. `DialogContent` in
  `src/components/ui/dialog.tsx` keeps the registry's `slide-in-from-left-1/2` and
  `slide-in-from-top-[48%]` classes, with the matching `slide-out-to-*`, besides the fade and
  zoom.
- The calendar's entry popover jumps to the window's top left as it closes after Save or
  Delete. Its anchor, the new slot's outline or the deleted entry's block, leaves the page
  while the popover animates out, and Kobalte then places it at 0, 0. Other popovers whose
  anchor goes away as they close may do the same.

`src/components/ui/` holds the registry's copies, so decide whether to change them there or
pass the classes at the call sites, and record the choice in `prototypes/README.md`
("Components").

A click on the entry whose popover is open also closed the popover and opened it again. It
should leave the popover as it is.

## Acceptance criteria

- [x] Dialogs fade in and out where they open, with no slide
- [x] Popovers, menus, and selects fade in and out in place, and none jumps when its anchor
      goes away as it closes
- [x] The calendar's entry popover stays beside its slot or entry while it closes after Save
      and Delete
- [x] A click on the open entry's block leaves its popover open, with no close and reopen
- [x] Reduced motion still turns the animations off (`src/styles.css`)
- [x] Checked in Chrome at 1440 and 390 px, light and dark
