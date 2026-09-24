# UI prototypes

Static HTML prototypes for comparing UI designs before building them in Solid. Open each file
directly in a browser (`file://`); no app server or build step. CDN dependencies need internet
access. Keep shared files beside the HTML so relative links work.

Render and check prototypes with the agent-browser CLI, see
[`docs/skills/ui-review/SKILL.md`](../docs/skills/ui-review/SKILL.md). When handing off a
prototype, include its full absolute `file:///` URL so it can be opened directly.

## Stack

| Piece                                   | Role                                                     |
| --------------------------------------- | -------------------------------------------------------- |
| Tailwind browser runtime 4.1.18         | Utilities; same Tailwind major/minor as the app          |
| Basecoat 1.0.2                          | shadcn-like components; approximates Solid-UI            |
| [prototype-theme.js](prototype-theme.js) | Dark variant and semantic color/radius mappings         |
| [prototype.css](prototype.css)          | Snowtime theme tokens and small shared styles            |
| Inline Lucide SVG paths                 | Icons, copied from `lucide-static` (pinned)              |

Dependency order in `<head>`:

```html
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.18"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/basecoat-css@1.0.2/dist/basecoat.cdn.min.css" />
<script src="https://cdn.jsdelivr.net/npm/basecoat-css@1.0.2/dist/js/all.min.js" defer></script>
<script src="prototype-theme.js"></script>
<!-- view-specific <style type="text/tailwindcss"> -->
<link rel="stylesheet" href="prototype.css" />
```

Keep versions pinned. Basecoat approximates shadcn's look and behavior; it does not run Solid-UI or
Kobalte, so production code uses the app's components.

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

When implementing the selected design, translate layout and interactions into Solid-UI components,
TanStack Query/Form, and server functions; do not port prototype JS.

## Conventions

- Label: "Snowtime prototype". UI copy in English (i18n comes later via Paraglide).
- Model interactions after the planned named mutations (`startTimer`, `stopTimer`,
  `updateEntry`, ...) so behavior maps cleanly to server functions.
- Display times with `Intl` in the browser zone; week starts Monday unless the prototype is about
  that setting.
- Render with small functions returning HTML strings; escape interpolated text. No template
  library or component system.
- Let Basecoat own component behavior. Read select changes from the root's `change` event
  (`event.detail.value`); set values with `selectRoot.value = ...`. Call `window.basecoat.initAll()`
  after inserting new component markup.
- Use Basecoat `data-variant` / `data-size` rather than restyling components with utilities.
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
- Keyboard access, select navigation and Escape, visible focus.
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
overflow and no browser errors. Known issue: Basecoat's destructive Stop button has low contrast
in dark mode with the app's `--destructive` token.
