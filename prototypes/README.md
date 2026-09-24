# UI prototypes

Static HTML prototypes for comparing UI designs before building them in Solid. Open each file
directly in a browser (`file://`); no app server or build step. CDN dependencies need internet
access. Keep shared files beside the HTML so relative links work.

Render and check prototypes with the agent-browser CLI, see
[`docs/skills/ui-review/SKILL.md`](../docs/skills/ui-review/SKILL.md). When handing off a
prototype, include its full absolute `file:///` URL so it can be opened directly.

## Stack

| Piece                                    | Role                                                        |
| ---------------------------------------- | ----------------------------------------------------------- |
| Tailwind browser runtime 4.3.3           | Utilities; same Tailwind version as the app (`bun.lock`)    |
| [ui.js](ui.js)                           | Solid-UI component classes, applied from `data-ui`          |
| tailwind-merge 3.7.0 (loaded by `ui.js`) | Class merging, same as the app's `cn()`                     |
| [prototype-theme.js](prototype-theme.js) | Dark variant, semantic color/radius mappings, base layer    |
| [prototype.css](prototype.css)           | Snowtime theme tokens from `src/styles.css`, shared styles  |
| Inline Lucide SVG paths                  | Icons, copied from `lucide-static` (pinned)                 |

Dependency order in `<head>`:

```html
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3"></script>
<script src="prototype-theme.js"></script>
<script src="ui.js"></script>
<!-- view-specific <style type="text/tailwindcss"> -->
<link rel="stylesheet" href="prototype.css" />
```

Keep versions pinned. There is no component library at runtime: prototypes use the same Tailwind
class strings as Solid-UI, so the look matches and markup ports directly, but Kobalte behavior
(popovers, keyboard handling, focus management) is not reproduced.

## Components

`ui.js` mirrors Solid-UI's components as attributes. `data-ui` is the component, `data-variant` and
`data-size` are its props, and the element's own `class` is merged in last like the `class` prop:

```html
<button data-ui="button" data-variant="outline" data-size="sm">Export</button>
<!-- <Button variant="outline" size="sm">Export</Button> -->
```

| `data-ui`                                     | Solid-UI source                | Variants / sizes                                              |
| --------------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| `button`                                      | `Button`                       | default, destructive, outline, secondary, ghost, link / default, sm, lg, icon |
| `badge`                                       | `Badge`                        | default, secondary, outline                                   |
| `toggle`, `toggle-group`                      | `Toggle`, `ToggleGroup(Item)`  | default, outline / default, sm, lg; pressed via `data-pressed` |
| `input`, `label`                              | `TextFieldInput`, `Label`      | —                                                             |
| `select`                                      | `SelectTrigger` classes        | native `<select>`, wrapped with Solid-UI's chevrons           |
| `card`, `card-header`, `card-title`, `card-description`, `card-content`, `card-footer` | `Card*` | —                                          |
| `table`, `table-header`, `table-body`, `table-row`, `table-head`, `table-cell`, `table-caption` | `Table*` | wrap in `relative w-full overflow-auto` like `Table` does |
| `dialog`, `dialog-header`, `dialog-footer`, `dialog-title`, `dialog-description`, `dialog-close` | `Dialog*` | native modal `<dialog>`; overlay via `::backdrop` |
| `popover`                                     | `PopoverContent`               | native `[popover]` + `popovertarget`; `ui.js` places it under the trigger |
| `switch`, `switch-thumb`                      | `Switch*`                      | `<button role="switch" aria-checked>`; `ui.js` toggles it and fires `change` |
| `error-message`                               | `TextFieldErrorMessage`        | mark invalid inputs with `data-invalid`                       |
| `alert`, `alert-title`, `alert-description`   | `Alert*`                       | default, destructive                                          |
| `separator`                                   | `Separator`                    | horizontal only                                               |
| `avatar`, `avatar-fallback`                   | `Avatar`, `AvatarFallback`     | —                                                             |

Kobalte's enter/exit animations are not reproduced. Classes are applied on load and to any
later-inserted or changed `data-ui` element. Change a
variant by setting `data-variant`; don't toggle classes on `data-ui` elements from JS, since the
original `class` is what gets re-merged. Start page scripts from `ui.ready`.

When a prototype needs another component, copy its class strings verbatim from the Solid-UI
registry into `ui.js`, keeping the commit noted at the top of the file. Badge variants
`success` / `warning` / `error` are left out because their tokens are not in `src/styles.css`.

## Workflow

1. Name the decision the prototype should help make. Read any existing Solid implementation and
   `docs/product.md` / `docs/architecture.md` so the prototype respects recorded behavior.
2. Create `prototypes/<feature>.html` with `lang`, UTF-8 charset, viewport meta, a descriptive
   title, and the dependencies above.
3. Start with one complete design; add meaningfully different variants only when they help the
   decision. Switch variants with `body[data-design]` and CSS, keeping state and form controls
   intact across switches.
4. Use fictional data and local state only. No network calls or real user data. Use
   `localStorage` only where the app will too (per-device view settings), wrapped in try/catch.
5. Make the interactions needed to judge the design work; disable out-of-scope actions. Include a
   fixture selector for empty, populated, long-content, and relevant edge states.
6. Run the checks below, then add a reference entry to this README.

When implementing the selected design, markup maps to Solid-UI components one to one
(`data-ui="card-title"` → `<CardTitle>`); wire behavior with TanStack Query/Form and server
functions. Do not port prototype JS.

## Conventions

- Label: "Snowtime prototype". UI copy in English (i18n comes later via Paraglide).
- Model interactions after the planned named mutations (`startTimer`, `stopTimer`,
  `updateEntry`, ...) so behavior maps cleanly to server functions.
- Display times with `Intl` in the browser zone; week starts Monday unless the prototype is about
  that setting.
- Render with small functions returning HTML strings; escape interpolated text. No template
  library or component system.
- Use components with their standard variants rather than restyling them with utilities; add
  layout classes (width, margin, flex) freely.
- Use native elements for behavior (`<select>`, `<details>`, `<dialog>`) instead of hand-rolled
  popovers.
- Icons: define `<symbol id="icon-<name>">` once per file, render with `class="prototype-icon"`.
  Copy paths from `https://cdn.jsdelivr.net/npm/lucide-static@1.48.0/icons/<name>.svg` (or
  `lucide-solid` once installed). Keep [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) with the
  files.
- Only add to `prototype.css` / `prototype-theme.js` what is useful across prototypes; keep
  feature styles in the HTML. When `src/styles.css` tokens change, update `prototype.css`.

## Checks before handoff

- Widths 1440, 850, and 390 px, every variant; no horizontal page scroll
  (`document.documentElement.scrollWidth === innerWidth`).
- Light and dark mode; every fixture, including empty and long content.
- Keyboard access and visible focus.
- No browser errors or failed CDN requests.
- Screenshots taken after transitions settle.

Gotchas:

- Use `grid-cols-[minmax(0,1fr)]` / `min-w-0` so long content cannot widen grid or flex tracks.
- Absolutely positioned elements (e.g. `sr-only`) inside an `overflow-x-auto` wrapper escape it
  unless the wrapper is `relative`, causing page-level horizontal scroll.

## Prototypes

### [timer.html](timer.html) — Timer and entries

Decision: layout of the main tracking view (running timer plus recent entries). All three layouts
are kept as user-selectable options.

- **Bar**: Toggl-style single-line timer; entries grouped by day in cards with day totals.
- **Focus**: large clock, "continue recent" chips, and a compact day list.
- **Table**: dense table with day subtotal rows; scrolls horizontally inside its container on
  narrow screens.

The settings button opens a **View** popover: layout, theme (light / dark / system), and whether
the summary panel (today / this week, per-project bars) is shown. Settings persist per device in
`localStorage` under `snowtime.viewSettings`, as planned for the app.

Entries are edited in a dialog opened from the pencil action or the time range: description,
project, date, start, and end. An end time at or before the start means the next day. Clicking the
running timer's clock edits the running entry's start date and time. Validation: all times
required, no entry ending in the future, no running entry starting in the future; a live line
shows the resulting duration.

Simulated: start/stop, Enter to start, editing the running entry inline or in the dialog, continue
(stops any running timer first), delete, edit. Fixtures: running, idle, long content, empty. Day
totals count stopped entries only; the summary includes the running timer. Entries are grouped by
their start day; splitting at midnight belongs to reports.

Omitted: overlap checks between entries, manual entry, reports, org/team switching, persistence of
entries.

Checked in Chromium at 1440, 850, and 390 px, light and dark, all layouts with summary on and off:
no horizontal page overflow, settings survive reload, dialog validation and saving work, no browser
errors.

### [auth.html](auth.html) — Sign-in flows

Decision: layout of the signed-out screens, and which sign-in methods appear on them (see
"Sign-in methods" in `docs/architecture.md`).

- **01 · Card**: the form in a centered card on a muted background.
- **02 · Split**: a dark brand panel beside the form on wide screens; form only on narrow ones.

Screens: sign in, sign up, verify email, forgot password (and its sent state), reset password
(and its done state), accept invitation, expired invitation, create organization, signed in. The
screen selector jumps to any of them; the forms also move between them.

Sign in and sign up show Google, GitHub, and Microsoft, then email and password. Sign in also offers
a passkey button, and the email field uses `autocomplete="username webauthn"` for passkey autofill.
The invitation screen names the organization, team, role, and invited address, and only accepts
that address, as Better Auth does. Create organization derives the short name from the name
until it's edited. Limits match Better Auth defaults: passwords of 8 to 128 characters, reset
links valid for 1 hour, invitations for 48 hours.

Simulated with fictional rules: the password `wrong` fails sign-in, `taken@example.com` is
already registered, and the short name `snowhound` is taken. Provider, passkey, and email steps
show a short loading state, then continue. The theme follows `snowtime.viewSettings` from the
timer prototype, or the system setting.

Omitted: two-factor authentication, rate-limit messages, and the real provider consent screens.
No design selected yet.

Checked in Chromium at 1440, 850, and 390 px, light and dark, both layouts and every screen: no
horizontal page overflow, validation messages and focus on the first invalid field, and no
browser errors.
