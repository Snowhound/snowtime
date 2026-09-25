# 030: Port inline entry editing

Status: done

Build the inline row editing selected in task 027 in `src/features/timer/`, following the
timer entry of `prototypes/README.md`. Rows lose the edit action; the entry dialog stays
for Add entry and the running entry's start.

## Acceptance criteria

- [x] Rows in the Bar, Focus, and Table layouts edit description, project, date, start,
      and end in place, with no edit action; below 768 px the Bar and Focus rows stack on
      three lines
- [x] Description and times save on Enter or blur and restore the saved value on Escape;
      the project saves when picked from a `DropdownMenu` with radio items and color dots,
      listing what `ProjectSelect` lists
- [x] A date popover moves the entry to another day, keeping its times; it saves on close
      or Enter and cancels on Escape
- [x] Each commit calls `updateEntry` with only the changed fields, optimistically; a
      failure rolls them back and shows the error on the row
- [x] Times follow the dialog's rules (`readEntryTimes`): the start's date, an end at or
      before the start is the next day with a "+1" mark, times required, no end in the
      future; an invalid value stays on the field, marked invalid, without saving
- [x] Duration is read-only and updates while typing
- [x] The quiet field style is passed at the call site, leaving `src/components/ui/` as the
      registry has it, and invalid inputs get a visible style: `error-foreground`, which
      `data-[invalid]` uses, maps to `destructive` in `src/styles.css`
- [x] Component tests cover saving a field, Escape, validation, the date popover, and a
      rolled-back save
