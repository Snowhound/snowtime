# 05: UX and UI

Status: done

The UI is mostly in good shape; this is a final pass for defects, not a redesign. Check
with the browser workflow in `docs/skills/ui-review/SKILL.md`.

## Acceptance criteria

- [x] Each view works at phone width and on desktop, in light and dark, on glass and
      solid surfaces, and in English and Estonian
- [x] Loading, empty, and error states exist for each list and form
- [x] Keyboard use and focus work in dialogs, popovers, menus, and the timer
- [x] Sticky and fixed elements stay clear of the sticky header on every page

## Checked on 2026-09-27

As Adam Admin, in the local dev app, with the browser workflow.

- **Views, sound:** Timer, Reports, Projects, Organization, Settings, Create organization,
  Privacy, and Terms, at 390 and 1440 px, light and dark, glass and solid, in English and
  Estonian. No page scrolls sideways; the Reports timesheet scrolls inside its card, as
  designed.
- **Keyboard, sound:** the organization switcher, account menu, Export menu, and row action
  menus keep focus inside and return it to their button on Escape. The Invite member, Create
  team, remove-member, and app icon dialogs, and Add entry, trap focus and return it.
- **Signed-out pages and invitation, sound:** Tab reaches every control on Sign in,
  Privacy, and Terms in order, with a visible focus ring, and the signed-out Appearance menu
  keeps focus inside and returns it on Escape. The invitation page works from the keyboard
  signed out, as the invited account, and as another account.
- **States, sound:** each list has an empty state, including a filtered one with no match.
  Pages that wait on the server show their pending view. Failed saves say why above the form
  or page, and form buttons show that they are working. Reports shows a failed report above
  the timesheet, and the Entries card its own error.
- **Header, sound:** `--app-header-height` matches the header at 390 and 1440 px. Anchored
  sections, the Settings section links, and the Reports scroll to the Entries card land
  below the header, and Shift+Tab never leaves focus under it.
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
  - When Show earlier failed to load, the timer's whole entry list disappeared without a
    message (`ff84618`, test). The shown days now stay, and the error shows by the button.
  - Invitations that failed to load showed "No open invitations" (`5699157`, test).
  - Sign-in methods that failed to load showed "Loading sign-in methods…" for good, and failed
    passkeys went unmentioned (`c41157d`, tests).
  - Popovers and menus opened from the page rode over the sticky header when the page
    scrolled (`8303fd2`). They mounted in the body, outside the app frame's stacking context.
    They now mount in a layer inside the frame (`src/lib/layers.ts`): the page's popovers sit
    under the header, the header's menus and dialogs over it. The component tests run in
    jsdom, without layout, so no test catches this.
