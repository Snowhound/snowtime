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
- **`createEntries` takes the shared fields once** (2026-11-02):
  `POST /organizations/:orgId/entries/batch` with `userId`, `projectId`, `description`, and
  `ticket` once and `entries: [{ id, startedAt, stoppedAt }]`, 1 to `MAX_BATCH_ENTRIES`
  (100). It answers `Entry[]` in input order. One check covers membership and the project,
  and a batch can't mix users. The client works out each copy's instants in the user's
  zone, so the server sees no patterns or time zones. Checks and insert run in one
  transaction. `entriesPerMemberPerDay` counts the batch's own entries, read in one range
  from the first start minus a day to the last start plus a day. A retry ends in 409
  `entry_id_taken`, as `createEntry`'s does. The route is app-only, not opened to keys, so
  it goes in `docs/architecture/timer.md` rather than `docs/api.md`. Rejected: a list of
  full entries, which is more general than copies need.
- **Undo uses `deleteEntries`** (2026-11-02): `POST /organizations/:orgId/entries/batch-delete`
  with `{ ids }` (1 to 100), atomic, the same logical delete, answering the ids. N single
  deletes would run into `writesPerUser` (120 a minute) partway through an Undo. Saving an
  existing entry with copies is `updateEntry` then `createEntries`; its Undo writes the old
  values back, then calls `deleteEntries`. Duplicate, Paste here, and Alt+drag are a
  `createEntries` of one, so they undo the same way. Past the cap, the copy panel says "At
  most 100 entries at once" and Save doesn't save.
- **Repeat leads** (2026-11-02, after a first build). Copy to more days becomes a Repeat
  field under the times, set to Doesn't repeat: a pattern fills its days up to Until at once,
  with no Fill button, and the month previews them, where a click takes a day out or adds
  one. ⌘V or Ctrl+V pastes at the quarter hour under the pointer. The entry menu's Copy to
  more days… becomes Repeat…. `prototypes/copy-entries.html` has it; the app still has the
  first version until the maintainer has agreed.
- **snowtime-native follows in its own session** (2026-11-02). This task changes only this
  repository; its route parity and conformance runs will report both routes as missing until
  that session ports them.

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
- [x] The entry popover and the list's rows take a typed duration (`1:30`, `1h 30m`, `90m`,
      `1.5`, `1,5`; a bare number is hours), with the errors the prototypes show.
- [x] Rows copy their duration with the copy button; day totals still copy on click;
      `docs/architecture/timer.md` says so.
- [x] The popover's Copy to more days picks days and fills them by Repeat and Until; saving
      creates the entry and its copies in one call that one Undo reverts.
- [x] Duplicate, Alt+drag, and the entry and empty-time context menus work as in
      `prototypes/copy-entries.html`, including from the keyboard (Shift+F10, the Menu key,
      ⌘C or Ctrl+C).
- [x] On touch, a long press opens the context menu, and a long press then drag moves the
      entry.
- [x] Conformance tests cover `createEntries` and `deleteEntries`: a batch saves all or
      nothing, the daily limit counts the batch's own entries, the cap, and a retried id.
