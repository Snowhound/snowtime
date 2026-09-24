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

Classes are applied on load and to any later-inserted or changed `data-ui` element. Change a
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
4. Use fictional data and local state only. No network calls, storage, or real user data.
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

Decision: layout of the main tracking view (running timer plus recent entries).

- **01 · Bar**: Toggl-style single-line timer; entries grouped by day in cards with day totals.
- **02 · Focus**: large clock, "continue recent" chips, compact day list, and a today/week summary
  with per-project bars.
- **03 · Table**: dense table with day subtotal rows; scrolls horizontally inside its container on
  narrow screens.

Simulated: start/stop, Enter to start, editing the running entry's description/project, continue
(stops any running timer first), delete. Fixtures: running, idle, long content, empty. Day totals
count stopped entries only; the Focus summary includes the running timer.

Omitted: editing past entries, manual entry, reports, org/team switching, persistence. No design
selected yet.

Checked in Chromium at 1440, 850, and 390 px, light and dark, all fixtures: no horizontal page
overflow and no browser errors. Stop uses the `secondary` button with a destructive icon: the
app's tokens set `--destructive-foreground` equal to `--destructive` in light mode (shadcn v4
tokens), which makes Solid-UI's `destructive` button text invisible until the tokens are fixed.
