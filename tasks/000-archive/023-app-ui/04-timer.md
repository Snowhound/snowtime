# 04: Timer and entries

Status: done

The main tracking view, in the Bar layout. It sets the optimistic-update pattern the
other views follow. Prototype: `prototypes/timer.html`.

## Acceptance criteria

- [x] Timer bar: description, project, start and stop (`startTimer`, `stopTimer`), Enter
      to start; the elapsed time ticks on the client and is never written
- [x] Editing the running entry inline and its start from the clock (`updateEntry`)
- [x] Entries from `listEntries`, grouped by start day in the user's zone, with day totals
      of stopped entries
- [x] Entry dialog: description, project, date, start, and end, with the prototype's
      validation and the live duration line; an end at or before the start means the
      next day
- [x] Continue (stops the running timer first) and delete (`deleteEntry`)
- [x] Manual entry of a past entry (`createEntry`), placed in the view; the prototype
      leaves it out, so this subtask decides where it goes: an "Add entry" button beside
      the page title opens the entry dialog empty, with today's date
- [x] Start, stop, edit, and delete are optimistic and roll back on error
- [x] Idle, running, empty, and long-content states

The view lists the last 14 days; "Show earlier entries" adds 14 at a time, up to 84 days
(`listEntries` returns at most 93). A timer running in another organization shows its
name and can be stopped, but its entry is edited from that organization.
