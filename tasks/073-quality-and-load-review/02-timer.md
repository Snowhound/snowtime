# 02: Timer

Status: todo

## Acceptance criteria

- [ ] `timer-calendar.tsx` is split in `calendar/`: the grid drag, the header, and the
      opening scroll each have their own file or function
- [ ] One helper builds an entry's changed fields for the calendar, the timer bar, and
      the rows
- [ ] The popover and the rows confirm and untick tickets through `createTicketDraft`
- [ ] One helper finds the last entry ended before a moment
- [ ] `weekendTime` reads the placed pieces, and `totalOn` is gone
- [ ] The calendar's repeated time formats, entry labels, and the `pieces()` map are
      folded into shared code
- [ ] One helper moves a time to another day, keeping its time of day
- [ ] `src/components/ui/README.md` lists the shared animation change once
