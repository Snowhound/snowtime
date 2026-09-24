# 029: Prototype brand font, colors, and icons

Status: in-progress

Try the draft brand from `design/brand-assets/` in the prototypes: first the font and
color scheme on every page, then the app icon and a picker for the 12 concepts. The font
and colors come first because the icon picker, charts, and the header mark are judged
against them. Task 033 ports them to the app.

The prototypes then lead `src/styles.css` instead of copying it. `prototypes/README.md`
must say so, so the "when `src/styles.css` tokens change, update `prototype.css`"
convention isn't applied backwards.

## Subtasks

1. [Font and colors](01-font-and-colors.md)
2. [App icon and picker](02-app-icon-picker.md)
3. [In-app marks without tiles](03-in-app-marks.md)

## Acceptance criteria

- [ ] All subtasks are done.
- [x] `prototypes/README.md` records the brand font, the token mapping, the icon setting,
      and that the prototype tokens are a proposal ahead of `src/styles.css`.
