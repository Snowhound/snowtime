# 02: Timer

Status: done

## Acceptance criteria

- [x] `timer-calendar.tsx` is split in `calendar/`: the grid drag, the header, and the
      opening scroll each have their own file or function
- [x] One helper builds an entry's changed fields for the calendar, the timer bar, and
      the rows
- [x] The popover and the rows confirm and untick tickets through `createTicketDraft`
- [x] One helper finds the last entry ended before a moment
- [x] `weekendTime` reads the placed pieces, and `totalOn` is gone
- [x] The calendar's repeated time formats, entry labels, and the `pieces()` map are
      folded into shared code
- [x] One helper moves a time to another day, keeping its time of day
- [x] `src/components/ui/README.md` lists the shared animation change once

## Findings

- `calendar/` now holds `grid-drag.ts` (pointer drag and the Alt+arrow keys),
  `calendar-header.tsx` (week navigation, total, Weekend toggle, day strip, and column
  headings), `calendar-status.tsx` (the status line with Undo), and `opening-scroll.ts`,
  which keeps the `ResizeObserver` that development needs. `timer-calendar.tsx` went from
  882 to 563 lines, short of the 450 hoped for: the popover wiring, Undo, and the ghost
  stay in the page.
- `src/features/timer` grew from 7,024 to 7,172 lines. The split costs about 140 lines of
  file headers and props; the shared helpers in `entries.ts` (`changedFields`,
  `lastEnded`, `entryLabel`) and `sameTimeOn` in `~/lib/calendar` save about as much as
  they add.
- `createTicketDraft` takes the fields it edits. The popover backs it with the form, and a
  row with its description and the saved ticket, resetting it when the saved description
  changes, so the known keys have one definition.
- `lastEndToday` now ignores entries that end after now. The server rejects those, so
  nothing changes in practice.
- The `totalOn` test's clock-change check now sums `piecesOn` over both days.
