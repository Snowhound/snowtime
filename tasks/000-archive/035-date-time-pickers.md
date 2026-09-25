# 035: Date and time pickers that fit the design

Status: done

The app's date and time fields are native `<input type="date">` and `<input type="time">`
through `TextFieldInput`: the entry dialog, the timer's inline entry fields
(`src/features/timer/entry-fields.tsx`), and the Reports filter bar. Each browser draws them its
own way, with its own calendar icon, popup, and segment focus, so they look out of place next to
the other controls and differ between Chrome, Firefox, and Safari. Touch them up so they match the
app's style and look the same everywhere.

This is for the app only; the prototypes keep their native inputs. Start after task 033 has
ported the prototypes' design, so the pickers are styled against the final tokens, surfaces, and
scene.

## Acceptance criteria

- [x] The date and time fields match the other inputs (height, border, radius, font, focus ring,
      icon) in light and dark, on glass and solid surfaces
- [x] They look and behave the same in Chrome, Firefox, and Safari, desktop and mobile, or
      `docs/architecture.md` records what stays native and why (for example the mobile pickers)
- [x] Typing, the keyboard, and screen readers work as well as with the native inputs, and the
      values follow the user's locale, time zone, and week start
- [x] Checked with `docs/skills/ui-review/SKILL.md` at 1440, 850, and 390 px, light and dark, in
      the entry dialog, the inline entry fields, and the Reports filter bar
