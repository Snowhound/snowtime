# Solid-UI copies

These files are copies of the Solid-UI registry at `stefan-karger/solid-ui` @ `21ba4fa`
(`apps/docs/src/registry/ui/`), the commit `prototypes/ui.js` also copies from. The app
changes a copy where every use needs the change, so call sites don't repeat it. Record each
change here, with its reason, in the same commit.

Copies not listed are unchanged apart from formatting and import order: `avatar`, `badge`,
`checkbox`, `label`, `separator`, `switch`, `table`, `tabs`, and `toggle`.

## Shared changes

- **Mount point.** `Dialog`, `DropdownMenu`, `Popover`, and `Select` portals mount in
  `layerRoot()` (`src/lib/layers.ts`) instead of the body, so they stack with the app frame's
  sticky header.
- **Stacking.** `DropdownMenuContent`, `DropdownMenuSubContent`, `PopoverContent`, and
  `SelectContent` use `z-20` instead of `z-50`. The page's popovers and menus scroll under the
  header (`z-30`). The header's own menus pass `z-50` to stay over it
  (`src/components/app-frame/app-header.tsx`).
- **Open and close animation.** Dialogs, popovers, menus, and selects fade and zoom in place.
  `DialogContent` drops the registry's `slide-in-from-*` and `slide-out-to-*` classes, which
  moved it in from the top left. `SelectContent` and `DropdownMenuSubContent` gain the closing
  animation the registry leaves out: `SelectContent` zooms from
  `--kb-select-content-transform-origin` like `PopoverContent`, instead of the registry's
  `animate-in fade-in-80`, and `DropdownMenuSubContent` uses `DropdownMenuContent`'s
  `animate-content-show` and `animate-content-hide`.

## Per component

- `alert.tsx`: adds a `warning` variant in the orange `--warning` color, for what needs the
  user but hasn't failed for good, such as changes the busy server hasn't saved yet. Its
  text passes 4.5:1 in both themes, over an opaque tint, so it reads over the scene.
- `button.tsx`: sets `data-variant` on the button, so the seasonal scene can give outline
  buttons a page-colored fill (`src/styles.css`).
- `card.tsx`: adds the `surface` class, so the seasonal scene can style cards as glass or
  solid.
- `dialog.tsx`: on close, returns focus to the element that had it when the dialog opened, or
  to a menu's button when a menu item opened it. Kobalte returns focus only to a
  `DialogTrigger`, and the app opens dialogs from state.
- `popover.tsx`: Tab wraps at the popover's ends, because a non-modal popover otherwise lets
  focus fall to the body. `Popover` remembers where its anchor last was, so it doesn't jump to
  0, 0 when the anchor leaves the page as it closes.
- `text-field.tsx`: the description and error message use `leading-snug`, so text that wraps
  keeps a line height.
- `toggle-group.tsx`: imports `toggleVariants` from `~/components/ui/toggle` instead of the
  registry's `~/registry/ui/toggle`.

## Files not in the registry

- `native-select.tsx`: `SelectTrigger`'s classes and chevrons on a native `<select>`, for long
  lists such as time zones.
- `text-field.test.tsx`: tests for `text-field.tsx`.
