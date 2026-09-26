# 05: UX and UI

Status: in-progress

The UI is mostly in good shape; this is a final pass for defects, not a redesign. Check
with the browser workflow in `docs/skills/ui-review/SKILL.md`.

## Acceptance criteria

- [x] Each view works at phone width and on desktop, in light and dark, on glass and
      solid surfaces, and in English and Estonian
- [ ] Loading, empty, and error states exist for each list and form
- [ ] Keyboard use and focus work in dialogs, popovers, menus, and the timer
- [ ] Sticky and fixed elements stay clear of the sticky header on every page

## Checked on 2026-09-27

As Adam Admin, in the local dev app, with the browser workflow.

- **Views, sound:** Timer, Reports, Projects, Organization, Settings, Create organization,
  Privacy, and Terms, at 390 and 1440 px, light and dark, glass and solid, in English and
  Estonian. No page scrolls sideways; the Reports timesheet scrolls inside its card, as
  designed.
- **Keyboard, sound:** the organization switcher, account menu, Export menu, and row action
  menus keep focus inside and return it to their button on Escape. The Invite member, Create
  team, remove-member, and app icon dialogs, and Add entry, trap focus and return it.
- **Fixed:**
  - On a full page load, the Settings language and season selects showed their first option
    instead of the saved one (`656bbac`). The server renders `value` on the select, which
    HTML ignores; the options now carry `selected`. The component tests render only in the
    browser, so no test catches this.
  - Wrapped field hints and errors had no line height (`5ed553a`).
  - Tab in the open project picker dropped focus to the page's start (`82976ba`, test).
  - Dialogs opened from state, such as New project, returned focus to the body on close
    (`419f2bd`, tests). They now return it to the opener, or to the menu's button when opened
    from a menu item.
  - Tab past the last control of a popover (View settings, Appearance, date, time) dropped
    focus to the body and left the popover open (`d3c1b86`, test).

Still to check: sticky and fixed elements against the header; loading, empty, and error
states; keyboard on the signed-out pages and the invitation page.
