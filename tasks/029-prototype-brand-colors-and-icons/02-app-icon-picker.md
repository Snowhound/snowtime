# 02: App icon and picker

Status: in-progress

Replace the prototypes' Lucide clock mark with concept `02`, Hound Hour, and let users pick
any of the 12 concepts. Start after subtask 01, so the picker is judged on the new font and
colors.

The picker is a dialog opened by clicking the header mark. The mark in `app-frame.js`
links to `timer.html` today; it becomes a button, and the Timer nav link remains the way
home. Settings also opens the dialog, so users who don't click the mark can find it.

Concept `02` also has an ice-tile version, built by `hound_hour.py`, because its navy tile
looks heavy on light pages. It follows the theme, and the dialog groups the concepts into light
and navy tiles, with Hound Hour in both.

Prototypes reference the exports in `../design/brand-assets/` (`icons/`, `icons-small/`,
`favicon/variants/`, `wordmark.svg`) instead of copying them. `file://` pages can load
images from a parent folder.

## Acceptance criteria

- [x] The header shows the selected concept's icon and the "Snowtime" name in the brand
      font (or `wordmark.svg`). The auth page's clock mark and split-layout brand panel
      use the same icon. The mark reads on the navy and ice tiles in both themes.
- [x] Clicking the mark opens a `<dialog>` listing all 12 concepts with number, name, and
      icon, with `02` marked as the default. It works with the keyboard (arrow keys or
      Tab between options, Escape closes, focus returns to the mark) and has a labeled
      heading. The Preferences section in Settings opens the same dialog.
- [x] `appFrame.settings` stores the choice as `appIcon` (`'01'` to `'12'`), falling back
      to `'02'` when the value is unset or invalid. Choosing updates the header mark and
      the real browser favicon immediately, on every open prototype tab, and survives
      reload and navigation. The auth page reads the same setting.
- [ ] The picker and header are checked in light and dark mode at 1440, 850, and 390 px:
      icon sizes, dialog overflow on mobile, the favicon at 16 px in the tab, and no
      browser errors.
- [x] `prototypes/README.md` documents the `appIcon` setting, the dialog, and the asset
      paths. The app frame's settings table lists `appIcon`.
