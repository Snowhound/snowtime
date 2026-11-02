# 096: Entry copies and typed durations

Status: todo

Two user requests from 2026-11-02. The first is to log one entry on many days, such as a
daily standup: fill a date range, or duplicate an entry and move the copies between days.
The second is to set an entry's length by typing a duration. The prototypes are
`prototypes/copy-entries.html` (the calendar and the entry popover) and
`prototypes/timer.html` (the list's rows); `prototypes/README.md` describes both.

## Decisions

- **Duration is editable** in the entry popover and in the list's rows (2026-11-02). Typing
  a duration keeps the start and moves the end; for the running entry it moves the start.
  This replaces the read-only duration in the rows.
- **Editing wins over click-to-copy in rows** (2026-11-02). A row's duration becomes a field,
  so copying it moves to the copy button beside it (`copy_duration_control` `button`
  mode), which rows then always use. Day totals keep click-to-copy. Update "Copying
  durations" in `docs/architecture/timer.md`.
- **All the copy paths stay** (2026-11-02): Copy to more days in the popover, Duplicate, Alt+drag, and
  the context menus with Copy and Paste, including Paste every workday, weekday, or month.
  They all lead to the same day picker, Repeat patterns, and save.
- **Future entries are allowed** already in the app; only a running entry can't start in the
  future. Copies may land after now.
- **Touch**: a long press opens the context menu in the app. The prototype doesn't emulate
  it. The calendar's earlier note reserved a long press for moving an entry; a long press
  that then drags should still move it, and one that lifts without moving opens the menu.

## Initial ideas

- The popover shouldn't grow a second form. The copy panel can be its own component that
  takes the entry's day, start, and length and returns the picked days; the popover's save
  then sends the entry and those days. A paste from the menu opens the same popover with
  the copied fields and a pattern, so it needs no code of its own beyond prefilling.
- One call creates the entry and its copies, so one Undo removes them all: either a
  `createEntries` route with a list of entries, or `createEntry` with a list of extra days.
  A list of entries keeps the server free of patterns and time zones; the client already
  works out each copy's instant in the user's zone.

## Acceptance criteria

- [ ] Before building the multi-day paste, the maintainer has seen and agreed how the
      popover and the copy panel split the work, so the dialog code stays simple.
- [ ] The entry popover and the list's rows take a typed duration (`1:30`, `1h 30m`, `90m`,
      `1.5`, `1,5`; a bare number is hours), with the errors the prototypes show.
- [ ] Rows copy their duration with the copy button; day totals still copy on click;
      `docs/architecture/timer.md` says so.
- [ ] The popover's Copy to more days picks days and fills them by Repeat and Until; saving
      creates the entry and its copies in one call that one Undo reverts.
- [ ] Duplicate, Alt+drag, and the entry and empty-time context menus work as in
      `prototypes/copy-entries.html`, including from the keyboard (Shift+F10, the Menu key,
      ⌘C or Ctrl+C).
- [ ] On touch, a long press opens the context menu, and a long press then drag moves the
      entry.
- [ ] Conformance tests cover the create call with copies.
