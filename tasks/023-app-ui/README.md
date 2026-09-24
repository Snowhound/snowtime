# 023: App UI

Status: in-progress

Build the MVP pages in Solid from the prototypes in `prototypes/` (task 013), on the
server functions from task 006. One subtask per view, in the order below: the foundation
and the app frame come first because every view depends on them.

Each subtask ports the selected prototype variant with its markup mapped one to one to
Solid-UI components, as `prototypes/README.md` describes, and does not port prototype JS.
Each view is a feature in `src/features/<name>/` with a thin route file, as the
"Code conventions" in `AGENTS.md` describe (task 026). UI strings are Paraglide messages from the start. English is written with each view;
Estonian can follow in one pass before this task is done.

## Acceptance criteria

- [x] `01-foundation.md`
- [x] `02-app-frame-and-sign-in.md`
- [x] `03-settings.md`
- [x] `04-timer.md`
- [x] `05-timer-layouts.md`
- [x] `06-projects.md`
- [ ] `07-reports.md`
- [ ] `08-organization.md`
- [ ] Every message has an `en` and an `et` translation
- [ ] Component tests (task 014) cover the interactions that carry rules, added in the
      subtask that builds them: for example the timer's start and stop, the entry dialog's
      validation, and role-dependent actions
- [ ] Each view passes the prototype checks in `prototypes/README.md`: 1440, 850, and
      390 px, light and dark, every state its prototype has fixtures for, keyboard
      access, and no browser errors
