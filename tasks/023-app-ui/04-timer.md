# 04: Timer and entries

Status: todo

The main tracking view, in the Bar layout. It sets the optimistic-update pattern the
other views follow. Prototype: `prototypes/timer.html`.

## Acceptance criteria

- [ ] Timer bar: description, project, start and stop (`startTimer`, `stopTimer`), Enter
      to start; the elapsed time ticks on the client and is never written
- [ ] Editing the running entry inline and its start from the clock (`updateEntry`)
- [ ] Entries from `listEntries`, grouped by start day in the user's zone, with day totals
      of stopped entries
- [ ] Entry dialog: description, project, date, start, and end, with the prototype's
      validation and the live duration line; an end at or before the start means the
      next day
- [ ] Continue (stops the running timer first) and delete (`deleteEntry`)
- [ ] Manual entry of a past entry (`createEntry`), placed in the view; the prototype
      leaves it out, so this subtask decides where it goes
- [ ] Start, stop, edit, and delete are optimistic and roll back on error
- [ ] Idle, running, empty, and long-content states
