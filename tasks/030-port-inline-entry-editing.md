# 030: Port inline entry editing

Status: in-progress

Build the inline row editing selected in task 027 in `src/features/timer/`, following the
timer entry of `prototypes/README.md`. Rows lose the edit action; the entry dialog stays
for Add entry and the running entry's start.

## Acceptance criteria

- [ ] Rows in the Bar, Focus, and Table layouts edit description, project, date, start,
      and end in place, with no edit action; below 768 px the Bar and Focus rows stack on
      three lines
- [ ] Description and times save on Enter or blur and restore the saved value on Escape;
      the project saves when picked from a `DropdownMenu` with radio items and color dots,
      listing what `ProjectSelect` lists
- [ ] A date popover moves the entry to another day, keeping its times; it saves on close
      or Enter and cancels on Escape
- [ ] Each commit calls `updateEntry` with only the changed fields, optimistically; a
      failure rolls them back and shows the error on the row
- [ ] Times follow the dialog's rules (`readEntryTimes`): the start's date, an end at or
      before the start is the next day with a "+1" mark, times required, no end in the
      future; an invalid value stays on the field, marked invalid, without saving
- [ ] Duration is read-only and updates while typing
- [ ] The quiet field style is a variant of `TextFieldInput`, and invalid inputs get a
      visible style: `data-[invalid]` uses `error-foreground`, which `src/styles.css`
      doesn't define
- [ ] Component tests cover saving a field, Escape, validation, the date popover, and a
      rolled-back save
