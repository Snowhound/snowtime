# 036: Add entry in a popover, with recent work in the description

Status: in-progress

The Add entry button opens a modal dialog, which covers the entries for a short form. Open
the form in a popover under the button instead, and under the timer's clock for the running
entry's start. Make the description fields in the popover and the timer bar a combobox of
recent work, so picking an earlier entry fills in its description and project. The design is
in `prototypes/timer.html` ("Timer and entries" in `prototypes/README.md`).

## Acceptance criteria

- [x] The prototype shows the popover and the combobox, and its README records the decisions
- [ ] The app opens Add entry and the running entry's start in a popover, and the Add entry
      button keeps its look
- [ ] Escape and a click outside keep a new entry's draft; Cancel and Save clear it
- [ ] A new entry's start defaults to the end of today's last entry
- [ ] The popover's and timer bar's descriptions list recent work with Kobalte's Combobox;
      picking fills in the description and project, typing never changes the project
- [ ] Component tests cover picking, the draft, and the default start
- [ ] Checked with `docs/skills/ui-review/SKILL.md` at 1440, 850, and 390 px, light and dark
