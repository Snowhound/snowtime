# 027: Prototype inline entry editing

Status: done

Prototype editing a stopped entry in place in its row, instead of in the entry dialog,
so a quick fix to a description, project, or time takes one click and no modal. The
decision is whether inline editing replaces the dialog, and what still needs one.
Prototype: `prototypes/timer.html`, following `prototypes/README.md`.

Today the pencil and the time range open the entry dialog (task 023, subtask 04). The
running entry is already edited inline in the timer bar, so the rows should behave the
same way.

Outcome: inline editing replaces the dialog and the edit action on rows, at every width,
with a date popover for moving an entry to another day. The Dialog and Inline control and
the native select comparison were removed once decided. The dialog stays for Add entry
and the running entry's start.

## Acceptance criteria

- [x] A prototype control switches entry editing between Dialog (today's behavior) and
      Inline, in every layout, keeping the fixture and layout across switches
- [x] Description: the row's text is an input on focus or click; Enter or blur saves,
      Escape restores the saved value
- [x] Project: a dropdown in the row with "No project", the active projects with their
      color dots, and the entry's archived or unavailable project, matching
      `ProjectSelect`. The prototype compares a `menu` with radio items against a native
      `select`, and records which one wins and why
- [x] Start and end: time inputs in the row. An end at or before the start means the
      next day, as in the dialog, and the duration updates as the user types
- [x] Duration: the prototype decides whether it is editable (changing the end) or stays
      read-only, and records the choice
- [x] Date: the prototype decides how an entry moves to another day (a date input in the
      row, a small popover, or the dialog kept for that), and the row moves to its new
      day group after saving
- [x] Each committed field saves on its own, modeled as `updateEntry` with only that
      field, optimistic, with a simulated failure that rolls the field back and shows an
      error on the row
- [x] Validation matches the dialog (times required, no end in the future), shown on the
      field without saving; the invalid value stays until fixed or Escape
- [x] Keyboard: Tab moves through a row's fields in order, focus is visible on each, and
      the continue and delete actions stay reachable
- [x] 390 px: the prototype decides whether rows edit inline or open the dialog, since
      five controls don't fit one line
- [x] Manual entry ("Add entry"): the prototype decides whether it adds an empty row
      inline or keeps opening the dialog
- [x] Fixtures: running, idle, long content, empty, plus an archived project and an
      entry crossing midnight
- [x] Checks from `prototypes/README.md` pass, and the timer reference entry in that
      README describes inline editing and its decisions
- [x] A follow-up task ports the chosen design, and task 023 subtask 05 (Table layout)
      notes which editing it uses
