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
| [prototype.css](prototype.css)           | Brand font and tokens (ahead of `src/styles.css`), shared styles |
| [app-icon.js](app-icon.js)               | App icon concepts, header mark images, and the favicon      |
| [app-frame.js](app-frame.js)             | App frame, user settings, icons, and markup helpers         |
| [scene.js](scene.js)                     | Seasonal scene: background, tint, WebGL weather             |
| [app-data.js](app-data.js)               | Shared fictional organization, generated entries, zone helpers |
| Inline Lucide SVG paths                  | Icons, copied from `lucide-static` (pinned)                 |

Dependency order in `<head>`:

```html
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3"></script>
<script src="prototype-theme.js"></script>
<script src="ui.js"></script>
<script src="app-icon.js"></script>
<script src="seasons.js"></script>
<script src="scene.js"></script> <!-- pages with the seasonal scene -->
<script src="app-frame.js"></script> <!-- signed-in pages only -->
<script src="app-data.js"></script> <!-- pages that need members, teams, projects -->
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
| `popover`                                     | `PopoverContent`               | native `[popover]` + `popovertarget`; `ui.js` places it under the trigger, or above when it doesn't fit |
| `switch`, `switch-thumb`                      | `Switch*`                      | `<button role="switch" aria-checked>`; `ui.js` toggles it and fires `change` |
| `error-message`                               | `TextFieldErrorMessage`        | mark invalid inputs with `data-invalid`                       |
| `alert`, `alert-title`, `alert-description`   | `Alert*`                       | default, destructive                                          |
| `separator`                                   | `Separator`                    | horizontal only                                               |
| `avatar`, `avatar-fallback`                   | `Avatar`, `AvatarFallback`     | —                                                             |
| `tabs-list`, `tabs-trigger`, `tabs-content`   | `TabsList`, `TabsTrigger`, `TabsContent` | `role="tab"` buttons with `aria-controls`; `ui.js` sets `data-selected`, arrow keys |
| `menu`, `menu-item`, `menu-radio-item`, `menu-label`, `menu-separator` | `DropdownMenu*` | native `[popover]` with `role="menu"`; `data-align="start"`; radio dot shows on `aria-checked="true"` |
| `checkbox`                                    | `CheckboxControl`              | native `<input type="checkbox">`; `ui.js` adds the check icon |
| `progress`, `progress-fill`                   | `ProgressTrack`, `ProgressFill` | set the fill width inline                                    |

Solid-UI has no date range picker; prototypes use two native `<input type="date">` fields
with `input` classes. Kobalte's enter/exit animations are not reproduced. Classes are applied on load and to any
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
4. Use fictional data and local state only. No network calls or real user data. The one
   `localStorage` key is the frame's stand-in for `user_settings` (see [App frame](#app-frame)),
   so settings carry across prototypes; wrap any access in try/catch.
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
  feature styles in the HTML. The tokens in `prototype.css` are a proposal ahead of
  `src/styles.css`, so don't copy `src/styles.css` over them; task 017 ports them to the app.
  See [Brand font and colors](#brand-font-and-colors).
- Keep each view in its own HTML file. The app frame is the shared exception, so every
  signed-in page has the same header; see [App frame](#app-frame).

## Brand font and colors

The prototypes try the draft brand from `design/brand-assets/` (task 029). `src/styles.css`
still has the neutral Solid-UI theme until task 017 ports these values.

UI text uses Plus Jakarta Sans (SIL OFL 1.1), the font the wordmark was outlined from.
`prototype.css` loads the variable font from `design/brand-assets/fonts/` with `@font-face`
(weights 200 to 800), and the `font-family` stack keeps the system fonts as fallback.
Its default digits are proportional, but `tabular-nums` switches to digits of one width, so
durations and table numbers stay aligned and the running clock doesn't jitter. Times and
durations therefore use the brand font with `tabular-nums` instead of `font-mono`; only the
invitation link keeps `font-mono`, because it's a URL.

The tokens come from the board's swatches (`design/input/asset-sytem-icon-picker.png`), which
are approximate readings of a generated image, not Snowhound brand values. Primary is a deep
slate blue, the `action` color in `design/brand-assets/theme-tokens.css`, rather than the board's
navy: navy primary buttons read as near-black, like the neutral theme. Navy stays the text color.
Icy blue (`#7fb3e6`) is too strong for a hover and too light for text
or borders, so no token uses it. The lowest ratio is the one against the weakest of
`background`, `card`, `popover`, `muted`, `accent`, and the page tint below; text needs 4.5:1,
`input` and `ring` 3:1. `border` is decorative and has no minimum.

| Token                       | Light                            | Dark                              | Lowest ratio (light / dark) |
| --------------------------- | -------------------------------- | --------------------------------- | --------------------------- |
| `background` / `foreground` | `#f4faff` ice / `#0f1f2e` navy   | `#0b1622` / `#e6f4ff`             | 15.33 / 14.68               |
| `card` / `-foreground`      | `#ffffff` / navy                 | `#142438` / `#e6f4ff`             | 16.72 / 14.00               |
| `popover` / `-foreground`   | `#ffffff` / navy                 | `#1e2f45` surface / `#e6f4ff`     | 16.72 / 12.11               |
| `primary` / `-foreground`   | `#2f6797` / `#ffffff`            | `#a7d0fb` highlight / `#0b1622`   | 5.99 / 11.33                |
| `secondary` / `-foreground` | `#d7ecfc` pale blue / navy       | `#1e2f45` / `#e6f4ff`             | 13.77 / 12.11               |
| `muted`                     | `#e4f1fc`                        | `#1e2f45`                         | —                           |
| `muted-foreground`          | `#3f6488`                        | `#9dbbd9`                         | 5.10 / 5.21                 |
| `accent` / `-foreground`    | `#d7ecfc` / navy                 | `#2a4160` / `#e6f4ff`             | 13.77 / 9.27                |
| `border`                    | `#c9e0f3`                        | `#263b54`                         | —                           |
| `input`                     | `#6a8cae`                        | `#587ba3`                         | 3.22 / 3.09                 |
| `ring`                      | `#3b82b8` slate blue             | `#4f7fb9` accent                  | 3.80 / 3.27                 |
| `destructive` / `-foreground` | `#dc0010` / `#ffffff`          | `#ff6467` / `#0b1622`             | 4.75 / 5.69; 5.18 / 6.31 on the button |

Colors that aren't board swatches, and why:

- `primary` `#2f6797`: slate blue darkened until white text on it is 5.99:1; as text or a
  checkbox border it's 5.49:1 on the page tint.
- `muted-foreground` `#3f6488`: slate blue is 3.94:1 on ice, so it's darkened to 5.10:1 at
  its weakest, on `accent`. Dark `#9dbbd9` sits between highlight and surface, 5.21:1 on
  `accent`.
- `muted` `#e4f1fc`: between pale blue and ice, so muted rows and the page tint differ from
  `secondary` and `accent`.
- `input` `#6a8cae`: the first try, `#7f9fbe`, was 2.53:1 on the page tint; this is 3.22:1.
  Dark `#587ba3` is 3.09:1 on `popover`.
- `destructive` `#dc0010`: the old red, `#e7000b`, was 4.37:1 on the page tint; this is
  4.75:1. Dark `destructive-foreground` is `#0b1622`, because white on `#ff6467` is 2.89:1.
- Dark `card` `#142438`: between background and surface, so cards lift off the page.
- Dark `accent` `#2a4160`: lighter than `popover`, so menu items show their hover (9.27:1
  with `accent-foreground`).
- `border` `#c9e0f3` and dark `#263b54`: tints of pale blue and surface for dividers.

The project and chart colors lean toward the brand too; see [App frame](#app-frame).

Signed-in pages tint the body with `bg-muted/40`. `prototype.css` gives `html` the
`background` color, so the tint sits on it instead of the browser's white or dark canvas; the
page tint is `#eef6fe` light and `#132030` dark.

Checked in Chrome on 2026-09-24, before the blue primary and the brand series colors, at 1440,
850, and 390 px, light and dark, every page with
every layout, fixture, and auth screen (306 states): no horizontal page overflow, a visible
focus ring, and no browser errors. axe's color-contrast rule passes in every state. Before
the brand tokens it failed on 33 elements at 1440 px, mostly the page title, prototype bar,
and muted text in dark mode, plus inactive tabs in light mode. Two axe findings not about
color remain, as before: `aria-prohibited-attr` on the Reports summary chart's bar groups and
`scrollable-region-focusable` on the timesheet at 390 px.

## App frame

[app-frame.js](app-frame.js) renders the signed-in chrome. Call
`appFrame.mount({ page, title, scene })` first in the page script. It inserts:

- A dashed **prototype bar** with the page title, the page's own controls (move them in with a
  `<div id="prototype-controls">`), and a role switcher (member, team lead, admin, owner).
- The **app header**: the app icon and name, linking to the timer; the organization switcher (a
  dropdown menu of the user's organizations); navigation (Timer, Reports, Projects, and
  Organization for admins and owners only); the **Appearance** button; and a user menu
  (Profile, Settings, Sign out). Below 768 px the navigation moves to a second header row of four
  equal-width links, so every page stays one tap away without a hamburger menu. Between 768 and
  1024 px the header drops the "Snowtime" name beside the mark, so the organization name fits.
- The **Appearance** popover, from the palette button left of the avatar, on every page: Theme
  (light, dark, system), the app icon with **Change** (opens the [app icon picker](#app-icon)),
  and the scenery settings: Season, Background with Strength and Surfaces under it, and Weather,
  whose hint names the season's effect or why it's off. Then "All settings". Hints are left out
  where the label says enough, so it fits a 390 × 844 screen. Theme used to be in the user menu
  and the timer's View popover too; it's only here and in Settings now. The intro's switch and
  Replay stay on the sign-in page and in Settings, since the intro only plays there.
- The season's **tagline** in the page's title row: from 1024 px centered on the page, level
  with the title, and below that on its own line under the title. If the centered tagline would
  come within 24 px of the title or the row's actions, it drops under the title too; it's
  re-placed on resize and when the season changes. It's two-toned like the intro: the
  first line in the season's headline color, the second in its second line's color (see
  [Seasonal copy](#seasonal-copy)). The season is the user's Season setting (see the Scenery menu
  below). Pages load [seasons.js](seasons.js) before `app-frame.js`. It replaced a tagline at
  the foot of the page over a fade, which covered the end of long lists and read as a footer.
  Pages with nothing right of the title (Reports, Projects, Organization, Settings) read as
  balanced with it centered, so they got nothing extra there.
- With `scene: true`, the **seasonal scene** behind the page; see [Seasonal scene in the app](#seasonal-scene-in-the-app).

It also provides:

| API                                  | Use                                                            |
| ------------------------------------ | -------------------------------------------------------------- |
| `appFrame.settings.get()` / `.set(patch)` / `.reset()` | The user's settings: `locale`, `timeZone`, `weekStart`, `theme`, `design` (timer layout), `showSummary`, `appIcon`, and the scene's (`sceneSeason`, `sceneBackground`, `sceneStrength`, `surfaces`, `sceneWeather`, `sceneIntro`). The app stores them in `user_settings`; the prototypes keep them in `localStorage` under `snowtime.prototypeSettings`. `set` saves, applies the theme, and notifies. |
| `appFrame.on('settings' \| 'role' \| 'org', fn)` | Re-render when settings, the prototype role, or the organization change |
| `appFrame.role`, `appFrame.isAdmin()`, `appFrame.org`, `appFrame.user` | Prototype session |
| `appFrame.openIconPicker()`, `appFrame.appIconImg(size, cls)` | Open the app icon dialog; an `<img>` of the chosen bare mark that follows changes |
| `appFrame.setUser(patch)`            | Swap the header's user, for long-content fixtures              |
| `appFrame.link(href)`                | A link that keeps `?role=` and `?org=`                         |
| `appFrame.escapeHtml`, `appFrame.icon(name)`, `appFrame.initials` | Markup helpers; `icon` uses the Lucide sprite the frame injects |

The role and organization live in the URL (`?role=admin&org=snowhound`) so they survive moving
between prototypes. Frame links with `data-frame-link="<href>"` keep them. Switching the
organization changes the header only; page data stays the same fictional Snowhound data. The
signed-in user is Anna Kask (`anna@snowhound.eu`), matching the invitation in `auth.html`.

### Seasonal scene in the app

Task 032 brings the sign-in page's scene (see [Seasonal scene and intro](#seasonal-scene-and-intro))
to the signed-in pages. Every signed-in page has it. A page opts in with
`appFrame.mount({ scene: true })` and loads [scene.js](scene.js) before `app-frame.js`. The frame
puts the scene in a fixed layer behind the page, from the same user settings as the sign-in page:
the season's image in light and dark, the tint, and the weather.

- **Settings**: the header's Appearance popover holds the scene settings (see
  [App frame](#app-frame)). Settings > Preferences groups them under **Scenery**, for the
  sign-in page and the app. Defaults: system theme, glass surfaces, and dimmed strength.
- **Surfaces**: the frame sets `data-scene`, `data-scene-bg`, and `data-surfaces` on the body, and
  [prototype.css](prototype.css) styles every `card` and every element with the `surface` class
  (the timer bar, the timesheet's wrapper, the empty state) from them. Glass is `bg-card/70` with
  a 24 px backdrop blur; solid keeps `bg-card`. Both get a soft shadow over the image. Popovers,
  menus, and dialogs stay solid, so their text never sits on the picture. With the background
  off, the page looks as before, with the weather over the page tint.
- **Over the image**: the header is the page color at 82% with a blur (solid for solid surfaces),
  the prototype bar is solid, page titles get a glow in the page color, and outline buttons
  outside popovers and dialogs a page-colored fill. The tagline gets the same glow as the title.
  Page-level notes get the glow too and a color between `muted-foreground` and `foreground`, since
  muted text was hard to read on the light images: subtitles and Reports' midnight note
  (`scene-text`), and the footnotes under Projects' and Organization's main cards (`page-note`,
  which are also centered, like the tagline).
- **Reports' timesheet**: its sticky first column is see-through like the glass card until the
  table scrolls sideways; then it's solid, so the cells scrolling under it don't show through. A
  translucent column let them show, and a solid one was a white strip on the glass.
- **Weather**: behind real work, the sign-in page's weather felt busy, so app pages run it
  **calm**: half the points and 70% of the speed. On the timer, the prototype bar's "Weather"
  select switches to the sign-in page's pace for comparison (`snowtime.prototypeAppScene`); other
  pages use the saved choice. As on the sign-in
  page, it stops in hidden tabs and stays off with reduced motion; the popover's switch then says
  why.

The timer page checked on 2026-09-24 in Chrome at 1440, 850, and 390 px, light and dark, every
season, every layout, glass and solid, full and dimmed, background off, and the running, long,
and empty fixtures: entry rows, inline project menu, date popover, and the entry dialog stay
readable; no horizontal scroll; no browser errors. With the long fixture, glass, and the weather
on, frames held 16.7 ms (p95 16.8 ms) at 1440 × 900 and 2× scale in headless Chrome, the same as
with the weather off. The weather stopped when the tab was hidden and restarted when shown. At
768 px the organization name "Snowhound" is 14 px short and truncates.

Reports, Projects, Organization, and Settings checked on 2026-09-25 in Chrome with every page at
1440, 850, and 390 px, light and dark (36 states with the timer and sign-in pages): no
horizontal scroll and no browser errors; the Appearance popover, the centered tagline, and the
timesheet scrolled and not.

### App icon

The header shows the user's app icon, one of the 12 concepts in `design/brand-assets/`
(task 029), and "Snowtime" in the brand font. Concept `02`, Hound Hour, is the default. The
mark links to the timer. The header's Appearance popover and Settings > Preferences >
Appearance open the app icon dialog from their **Change** buttons.

Inside the app, every place shows the concept's bare mark, with no tile, in its light-page or
dark-page version: the header, the dialog, the Settings preview, and the sign-in card. Only the
favicon keeps the tiled icon. Each concept's favicon is on either an ice tile or a navy tile, so
the dialog groups them by it: **Light tab icons** (01, 03, 06, 08, 09, 11) and **Navy tab icons**
(02, 04, 05, 07, 10, 12). Each option shows the mark for the page's theme with the tiled icon as a
small badge, the tab icon it gives. Hound Hour has both tiles, and its favicon follows the
system theme: the ice tile in a light tab strip, the navy tile in a dark one. It's listed once,
first among the navy tab icons.

Each group is its own radio group, so at most one option per group is checked; an option shows
its number, name, and icon, and `02` has a Default badge. Tab moves between the groups, arrow
keys move through a group's grid and choose, Home and End jump, Escape or Done closes it, and
focus returns to the control that opened it. On open, focus goes to the chosen option. A choice saves right away,
like the other settings, and updates the header mark, the Settings preview, and the favicon.

The choice is the `appIcon` setting, `'01'` to `'12'`; an unset or unknown value falls back to
`'02'`. [app-icon.js](app-icon.js) holds the concept list, reads the setting, and sets the
favicon, every bare mark `<img data-app-mark>`, and every tiled `<img data-app-icon>`. Load it in `<head>` before `app-frame.js`, so the tab
shows the icon before the page renders. `auth.html` has no frame and loads only `app-icon.js`.
Other tabs follow a change through the `storage` event.

The prototypes reference the exports in place instead of copying them:

| Use                                        | Path under `design/brand-assets/`                   |
| ------------------------------------------ | --------------------------------------------------- |
| Header and sign-in card mark (28 px)       | `marks/<NN-name>-light.svg` or `-dark.svg`; 02 uses `marks-small/` |
| Dialog and Settings mark (40 to 56 px)     | `marks/<NN-name>-light.svg` or `-dark.svg`          |
| Dialog's tab icon badge (20 px)            | `icons-small/<NN-name>.svg`, 02 also `-light`       |
| Favicon                                    | `favicon/variants/<NN-name>-16.png`, `-32.png`; 02 also `-light` |

Page images follow the page's theme, and `app-frame.js` and `auth.html` call `appIcon.apply()`
again when it changes. The favicon follows the system's color scheme instead, because the
browser's tab strip does, not the page.

`appFrame.appIconImg(size, cls)` returns the chosen mark, fitted into a square with
`object-contain`, since the marks aren't square. The badges keep a `ring-border` outline with
the exports' corner radius (22.5%), so an ice tile shows on the light popover.

The marks were checked on 2026-09-24 at 64, 28, and 20 px on the light page, white, and the dark
page. Only 02 needed a small version (no facets, thicker hands); the traced marks read at 20 px
as they are.

Checked in Chrome on 2026-09-24 at 1440, 850, and 390 px, light and dark: the header mark,
the dialog (it fits 390 × 844 without scrolling the page), keyboard use and focus return, an
invalid stored value falling back to `02`, all 24 favicon PNGs loading, Hound Hour switching
tiles with the theme on the signed-in pages and `auth.html`, the favicon and marks following a
change in another tab, and no browser errors. Headless Chrome
has no tab strip, so the 16 px favicon in a real tab still needs a look in a headed browser.

[app-data.js](app-data.js) holds the fictional Snowhound organization: nine members, three teams
(Platform, Design, Client services) with leads, the timer's projects plus an archived one, and
about ten weeks of generated entries in Tallinn time, including a few that cross midnight and
Anna's running timer. `appData.organization({ role, long })` returns fresh copies; as team lead,
Anna leads Platform. `appData.tz` computes day and week starts in any IANA zone, DST included.

Project colors come from eight categorical slots (`--series-1` to `--series-8` in
[prototype.css](prototype.css)), in the same fixed order of hue families as the dataviz reference
palette but in cooler, muted steps that suit the brand: slate blue (the brand's `#3b82b8`),
terracotta, teal, ochre, rose, moss, indigo, and brick. A palette of blues alone would fail,
because neighboring series must stay distinct, including under color-vision deficiency.

| Mode  | Slots 1 to 8                                                                   |
| ----- | ------------------------------------------------------------------------------ |
| Light | `#3b82b8` `#d9703f` `#1f9e8a` `#d59a1c` `#c9759f` `#4f8f3a` `#5a4fa8` `#c9514f` |
| Dark  | `#357cb2` `#cc6433` `#119884` `#af7c00` `#ba6791` `#498934` `#6e68b2` `#c24b49` |

Each dark step keeps its light slot's hue, with lightness and chroma set so it reaches 3.2:1 on
the dark card. The dataviz validator passes both modes against the light card `#ffffff` and page
`#eef6fe`, and the dark card `#142438`, page `#132030`, and popover `#1e2f45`: lightness band,
chroma floor, adjacent-pair color-vision separation (worst ΔE 10.4 light, 10.9 dark; target 8),
and the normal-vision floor (19.5 light, 17.5 dark; floor 15). Below 3:1 are ochre on the light
card, rose too on the light page, and indigo and brick on the dark popover, so charts always
carry a legend or labels and a table view, and project dots sit beside their names.
`project.color` stores the light hex, and dark mode uses each slot's dark step.

## Checks before handoff

- Widths 1440, 850, and 390 px, every variant; no horizontal page scroll
  (`document.documentElement.scrollWidth === innerWidth`).
- Light and dark mode; every fixture, including empty and long content.
- Keyboard access and visible focus.
- No browser errors or failed CDN requests.
- Screenshots taken after transitions settle.

Gotchas:

- Use `grid-cols-[minmax(0,1fr)]` / `min-w-0` so long content cannot widen grid or flex tracks.
- `ui.js` styles inserted markup in a `MutationObserver` callback. Measure overflow in a
  separate step after a fixture change, not in the same script, or unstyled elements are measured.
- Absolutely positioned elements (e.g. `sr-only`) inside an `overflow-x-auto` wrapper escape it
  unless the wrapper is `relative`, causing page-level horizontal scroll.

## Prototypes

### [projects.html](projects.html) — Projects

Decision: how admins and owners create, edit, assign, archive, and delete projects, and what
members and team leads see of them.

The list shows each project's color, name, teams, and time this month, sorted by name, with
Active and Archived tabs and a name search. A project with no teams shows "Whole organization".

| Role         | Sees                                                     | Time column         | Actions |
| ------------ | -------------------------------------------------------- | ------------------- | ------- |
| Admin, owner | Every project                                            | The organization's  | New project; per project: edit, archive or restore, delete |
| Member, team lead | Projects with no teams, and those assigned to their teams | Their own         | None; a note says admins and owners manage projects |

Visibility follows `visibleProjects` in `src/server/projects/projects.server.ts`: a team lead sees the
same projects as a member. The time column would come from `getReport` over this month in the
user's time zone; leads get their team's time in Reports. The Client support project is
assigned to Client services only, so members and leads don't see it.

- **Create and edit**: one dialog with the name, eight color swatches from `appData.PALETTE`
  (radio inputs), and a checkbox per team. A hint names who can track time on the project: the
  whole organization with no teams checked, otherwise the checked teams plus admins and owners.
  A new project gets the least used color. Names are trimmed, 1 to 100 characters, and unique
  among projects that aren't deleted, archived ones included, matching
  `project_organization_id_name_unique`. A clash with an archived project suggests restoring
  it. Archived projects can still be edited. Saving maps to `createProject` or `updateProject`,
  then `assignProjectToTeam` and `unassignProjectFromTeam` for the changed teams.
- **Archive and restore**: archive asks first, because nobody can then track new time on the
  project; its time stays in reports. Restore acts at once (`archiveProject`,
  `unarchiveProject`).
- **Delete**: for projects created by mistake (task 020). The prototype mirrors
  `deleteProject`: after confirming, a project with time entries gets the `CONFLICT` message
  and an "Archive instead" button, or only an explanation when it's already archived. Q4
  planning and the archived Website 2025 have no time and can be deleted.

Fixtures: populated, new organization (no projects, no teams, so the dialog links to
Organization), and long content (long project and team names, fourteen projects).

Omitted: project details or per-project reports, custom colors, bulk actions, and moving time
between projects.

Checked in Chromium at 1440, 850, and 390 px, light and dark, both tabs and every fixture, as
member, team lead, and admin: no horizontal page overflow, dialog validation and keyboard use of
the swatches, and no browser errors. axe reports no color-contrast issues since the brand
tokens (see [Brand font and colors](#brand-font-and-colors)).

### [organization.html](organization.html) — Organization admin

Decision: how admins and owners manage members, invitations, and teams without email.

Four tabs:

- **Members**: search, each member's teams (with "Lead"), role select, and remove. Owners change
  any role; admins manage members and admins but not owners and can't grant owner. Nobody changes
  their own role, and the last owner can't be demoted or removed.
- **Invitations**: open invitations with role, team, inviter, and time left. "Invite member" takes
  an email, role, and optional team and returns a link to copy, because the MVP sends no email.
  Links last 48 hours; expired ones get a new link, and any can be canceled. Existing members and
  addresses with an open invitation are refused.
- **Teams**: a card per team with its lead, a Lead or Member select per person (`setTeamRole`),
  remove, add a member, rename, and delete. Deleting a team names the projects that lose it and
  the ones that then become available to the whole organization.
- **General**: the name, the read-only short name, and a note that organizations can't be deleted.

Writes are named after the calls they map to: the Better Auth organization client for members,
roles, invitations, and teams, and `setTeamRole` for leads (`docs/architecture.md`, "Tenancy").
Members and team leads get a no-access message; the navigation hides the page for them. The
invitation link's origin is a placeholder; the app builds it from `BETTER_AUTH_URL`.

Fixtures: populated, new organization (only Anna, plus an owner when Anna isn't one), and long
content (23 members, long names, a long team name, a long invited address).

Omitted: transferring ownership, leaving the organization, and bulk invitations.

Checked in Chromium at 1440, 850, and 390 px, light and dark, every tab and fixture, as member,
admin, and owner: no horizontal page overflow, dialogs with validation, and no browser errors.

### [reports.html](reports.html) — Reports

Decision: how day and week totals by project, team, and member read, for members, team leads,
and admins. **02 · Timesheet** is selected for the app; the other two stay for comparison.

- **01 · Summary**: stat tiles (total, average per tracked day, top project), stacked columns per
  day or week by project with a hover and focus tooltip, a Table tab with the same values, and
  share bars by the chosen grouping.
- **02 · Timesheet (selected)**: a grid of rows by the chosen grouping and a column per day or
  week, with row and column totals and today's column shaded. It scrolls horizontally inside its
  card with the first column sticky.
- **03 · Breakdown**: a two-level outline (project, then member; member, then project; team, then
  member) with share bars, the first three groups open.

Filters sit in one row: a range preset (today, this week, last week, this month, last month,
custom), previous and next, from and to dates, People, Group by, and Totals per day or week.
Ranges over 35 days switch to weeks. Days and weeks follow the user's time zone and week start
from Settings; the subtitle links there.

Aggregation follows task 007: entries are clipped to the range and split at midnight in the
user's zone (a note counts the entries that crossed), and the running timer counts up to now.
Teams count their current members, so a member in two teams counts in both; the total row counts
each entry once.

| Role      | People options                                  | Group by                 |
| --------- | ----------------------------------------------- | ------------------------ |
| Member    | None: own time only                             | Project only             |
| Team lead | Their led team (Platform), and its members      | Project, team, member; teams limited to led teams |
| Admin, owner | Everyone, each team, each member              | Project, team, member; members in no team as "No team" |

Charts fold projects past seven into "Other". Fixtures: populated, empty, and long content (long
project, member, and team names, twelve projects).

Omitted: exports, filters by project or description, saved reports, and billable rates.

Checked in Chromium at 1440, 850, and 390 px, light and dark, every layout and fixture, as
member, team lead, and admin: no horizontal page overflow, tooltip within the viewport, and no
browser errors.

### [settings.html](settings.html) — Settings

Decision: one settings page, with every setting saved to the account, and how it relates to the
timer's View popover.

Two cards, with section links beside them from 1024 px:

| Card        | Stored in         | Fields                                                         |
| ----------- | ----------------- | -------------------------------------------------------------- |
| Preferences | `user_settings`   | Language, time zone, week start, theme, timer layout, show summary, scenery; each saves on change |
| Profile     | `user`, `account` | Name with "Save profile"; email read-only; sign-in methods      |

Preferences come first because they change most often. Theme and timer layout moved from
per-device `localStorage` into `user_settings` so they follow the user and the server can render
the theme without a flash; the column change is with the backend (task 018 added `locale`). The
Language select offers English and Eesti and changes nothing yet; translations are task 012.

The email is read-only because invitations are matched to the verified address and changing it
would need email verification (task 016). Sign-in methods list Google, GitHub, and Microsoft with
Connect (Better Auth `linkSocial`, simulated redirect) and Disconnect (`unlinkAccount`, confirmed
in a dialog). Disconnect is disabled on the last linked method. Passkeys show as planned (task
015). The time zone select lists `Intl.supportedValuesOf('timeZone')` with the current UTC
offset, plus a button for the device's zone; a preview shows the current time and this week's
range in the chosen zone and week start.

The timer's gear popover stays as a shortcut to the timer's view fields, and the header's
Appearance popover to the theme, app icon, and scenery, each with an "All settings" link. They
and this page write through `appFrame.settings`, so they never disagree; other open tabs follow
through the `storage` event.

Fixtures: populated (Google and GitHub), new account (one provider; resets preferences to the
defaults with the browser's zone), long content (long name and email), and local dev password
(only the seeded credential account).

Omitted: avatar upload, email change, account deletion (users are anonymized, not deleted), and
active sessions.

Checked in Chromium at 1440, 850, and 390 px, light and dark, every fixture, as member and owner:
no horizontal page overflow, settings shared with the timer and reports across pages, menu focus
and Escape, and no browser errors.

### [timer.html](timer.html) — Timer and entries

Decision: layout of the main tracking view (running timer plus recent entries), and whether
stopped entries are edited in their row or in a dialog. All three layouts are kept as
user-selectable options.

- **Bar**: Toggl-style single-line timer; entries grouped by day in cards with day totals.
- **Focus**: large clock, "continue recent" chips, and a compact day list.
- **Table**: dense table with day subtotal rows; scrolls horizontally inside its container on
  narrow screens.

The settings button opens a **View** popover: layout and whether the summary panel (today / this
week, per-project bars) is shown, plus a link to Settings. The theme is in the header's
Appearance popover.
These are user settings, saved through the app frame (`user_settings` in the app).

Stopped entries are edited in their row, with no dialog or edit action (task 027). Each
row's description, project, date, start, and end are controls that read as text until
hovered or focused. Description and times save on Enter or blur and restore the saved value
on Escape; the project saves when picked. Each commit is `updateEntry` with only the changed
fields, applied at once. A failed save (the prototype bar's "Fail saves") rolls the fields
back and shows an error under the row. Tab moves through description, project, date, start,
end, continue, and delete.

The entry dialog stays for Add entry and for the running entry's start, opened from the
timer's clock. It has description, project, date, start, and end, with the validation the
rows use, and a live line with the resulting duration.

Decisions:

- **Project picker: a `menu` of radio items** behind a ghost button. The trigger shows the dot
  and name like the read-only row, and every option has its color dot. A native select, even
  quiet, shows chevrons on every row, can't show dots in its options, and cut "Website 2025
  (archived)" short. The timer bar and dialog keep `ProjectSelect`.
- **Times: start and end inputs, read as in the dialog.** The date is the start's, an end at or
  before the start means the next day, and "+1" marks it. A time in the saved minute keeps the
  saved instant, so seconds survive.
- **Duration: read-only**, updating as the user types. Start and end already set it, and an
  editable duration would be a third way to change the end.
- **Date: a calendar button with a popover**, shown on row hover or focus like the actions. The
  popover has a date input and saves when it closes or on Enter; Escape cancels. The times
  and duration stay, so the entry moves to that day, then the row moves to its new day group
  and flashes. A date field in the row would widen every row for a rare change.
- **Validation: as in the dialog, per field**: times required, no end in the future. The field
  and a line under the row show the error. Nothing saves, and the value stays until fixed or
  Escape, because saving a half-typed time would write a wrong entry. The date popover shows
  its error while open and discards an invalid date on close.
- **Below 768 px: the same fields, stacked.** Description on the first line, project and the
  actions on the second, date, times, and duration on the third. The Table layout keeps one
  line and scrolls inside its card.
- **Add entry: the dialog.** A new entry needs a start and an end before it exists, so it can't
  save one field at a time.

Inline fields add `border-transparent shadow-none` to `input` and `button`, with the border
back on hover and focus; the app passes the same classes at the call site
(`src/features/timer/entry-fields.tsx`), keeping `src/components/ui/` as the registry has
it. Invalid inputs use Solid-UI's `error-foreground`, which `src/styles.css` and
[prototype-theme.js](prototype-theme.js) map to `destructive`.

Simulated: start/stop, Enter to start, editing the running entry inline or in the dialog,
continue (stops any running timer first), delete, inline edits, and Add entry. Fixtures: running,
idle, long content, empty. Running and idle include an entry crossing midnight and one on
the archived Website 2025 project; long content includes one on a project the user can no
longer see. Day totals count stopped entries only; the summary includes the running timer.
Entries are grouped by their start day; splitting at midnight belongs to reports.

Omitted: overlap checks between entries, reports, persistence of entries.

The page has the seasonal scene behind it; see [Seasonal scene in the app](#seasonal-scene-in-the-app).

Checked in Chromium at 1440, 850, and 390 px, light and dark, all layouts with summary on and off:
no horizontal page overflow, settings survive reload, dialog and inline validation and saving
work, failed saves roll back, focus stays on the edited field across saves, the date popover
saves on Enter and cancels on Escape, and no browser errors. axe reports no color-contrast
issues since the brand tokens.

### [auth.html](auth.html) — Sign-in flows

Decision: layout of the signed-out screens, and how the sign-in methods in
`docs/architecture.md` ("Sign-in methods") appear on them.

The form sits in a centered card on a muted background, or on the seasonal scene. This card layout
is the one the app uses; a split layout with a brand panel beside the form was tried and removed
(task 031).

The **password** toggle shows the three stages of password sign-in:

| Mode        | Stage                              | What the screens show                                        |
| ----------- | ---------------------------------- | ------------------------------------------------------------ |
| No password | MVP in deployed environments       | Google, GitHub, Microsoft, and passkey buttons only          |
| Local dev   | MVP in local development           | Providers plus an email and password form for seeded users   |
| With email  | Later, once email exists (task 016) | Providers, password form, sign-up, forgot and reset password |

MVP screens: sign in, accept invitation, invitation opened with the wrong account, expired
invitation, create organization, and signed in. Screens under "Later (needs email)" in the
selector (sign up with password, verify email, forgot and reset password) switch the toggle to
"With email".

The first provider sign-in creates the account, so the MVP has no separate sign-up screen. The
invitation screen names the organization, team, role, and invited address. Better Auth only
accepts an invitation from a user with that verified email, so a different account lands on the
wrong-account screen. Create organization derives the short name from the name until it's
edited. The passkey button depends on task 015. Limits match Better Auth defaults: passwords of 8
to 128 characters, reset links valid for 1 hour, invitations for 48 hours.

The tagline, the season's first two intro lines ("Winter is coming. So is the end of the month."
in winter), sits above the card in the intro's two colors, as beside every signed-in page's title
(see [App frame](#app-frame)). The mark is the chosen app icon (see [App icon](#app-icon)).

#### Seasonal scene and intro

Task 031 tries a seasonal scene from `design/backgrounds/`: a landscape per season in a light and
a dark version, a tint of the page color over it, and a weather effect. Winter's is the WebGL
snow from `snowtime_login_intro_with_backgrounds.html`, ported to [scene.js](scene.js); the other
seasons' effects are rough versions built the same way, for comparison. Each effect draws its
points in one call on one shared canvas, runs at about 45 fps, stops when the tab is hidden or the
weather is off, and scales its point count to the area it covers. Unlike the mock-up, snow covers
the full width.

The images are upscaled to 3840 px and come as WebP files 1920 and 3840 px wide (see
`design/backgrounds/README.md`). `scene.js` picks the 3840 file when the image covers more than
2400 device pixels across: `cover` stretches it to the larger of the viewport's width and its
height's 16:9 width, times the pixel ratio (at most 2). Screens under 768 px wide always get the
1920 file. The shown theme's layer gets the 1920 file first and swaps to the 3840 one once it has
loaded and decoded, so the picture sharpens without moving. The other theme's layer gets its 1920
file after that, for the crossfade. Nothing loads while the background is off, except that the
intro calls `preload('dark')`, which loads the dark 3840 file while the intro opens on the
weather alone.

Checked on 2026-09-25 in headless Chromium with the cache off, autumn (the month's season), times
from navigation:

| Case                    | Fast 4G (9 Mbps, 170 ms)                                   | Slow 4G (1.6 Mbps, 150 ms)                                                 |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1440 × 900 at 2×, intro | Dark 3840 (509 KB) ready at 1.3 s; background in at 3.7 s  | Dark 3840 ready at 4.9 s, 0.7 s into the fade; the 1920 file shows until then |
| 1440 × 900 at 2×, light | 1920 (277 KB) at 1.3 s, 3840 (637 KB) at 1.7 s             | 1920 at 4.9 s, 3840 at 6.6 s                                               |
| 1440 × 900 at 1×, dark  | 1920 (232 KB) only, at 1.1 s                               | 1920 only, at 3.3 s                                                        |
| 390 × 844 at 3×, light  | 1920 (277 KB) only, at 1.1 s                               | 1920 only, at 3.5 s                                                        |

- **Scene**: it fills the page behind the card. The light and dark images show the same view at
  another time of day, so a theme change only crossfades them; a slight zoom on the shown image
  made the mountains move and was removed.
- **Intro**: about 13 seconds, always dark. It opens on the weather alone over the page color,
  shows the first line, pauses, fades the background in (over 2.6 s), pauses again, and then
  shows the other lines, each once the one before has had time to be read. The last line ("Sign
  in and get it done!") comes after a longer beat, eases in more slowly, and stays for 3 seconds.
  Then the page rises into place and the chosen theme returns. The intro always shows the weather
  and the background, even when they're off for the page; the page follows the switches once it
  appears. Each season has its own lines and colors, from [seasons.js](seasons.js) (see
  "Seasonal copy" below): white and ice in winter, fresh green and meltwater teal in spring,
  firefly yellow and green in summer, and the leaves' amber and rust in autumn, each on the
  headline and the last line. On a first visit to this browser, the intro plays dark in any
  system theme, and after it the page keeps the background (on by default) and follows the system
  theme. When the intro is due, a small script in `<head>` paints the page black until it starts,
  so a light-mode visitor sees no flash of the light page first. It plays on the first visit to this browser
  (`snowtime.introSeen` in `localStorage`) unless the Intro switch is off; Replay intro plays it any
  time. **Skip intro** or Escape ends it; the rest of the page
  is `inert` while it plays. With reduced motion it doesn't play, and the snow stays off.
- **Scenery menu** (the mountain button, top right): Season (Auto, which follows the month and
  names the current season, or winter, spring, summer, or autumn), then the Background switch, with two options
  under it that apply only while it's on: Strength (dimmed, the default, or full: how much page
  color covers the image, 55 or 30% dark, 50 or 20% light, stronger toward the bottom) and Surfaces (glass,
  `bg-card/70` with a backdrop blur, or solid cards). Then the Weather switch, the Intro switch,
  and Replay intro. These are the user settings `sceneSeason`, `sceneBackground`, `sceneStrength`, `surfaces`,
  `sceneWeather`, and `sceneIntro`, shared with Settings > Preferences > Scenery, which lays
  them out the same way. Signed out, the app would keep them on the device. Surfaces applies to
  every card, on the signed-in pages too (see [Seasonal scene in the app](#seasonal-scene-in-the-app)).
- **Weather**: each season's effect, colored for its image in light and dark and for the plain
  page. The canvas blends with premultiplied alpha, so edges don't darken.

  | Season | Effect                                                                                  | Points per 1440 × 900 |
  | ------ | --------------------------------------------------------------------------------------- | --------------------- |
  | Winter | Snow: white in dark mode and over the light image, blue-grey on the plain light page     | 500                   |
  | Spring | A light shower: thin streaks slanted with the wind, in soft bursts that come and go      | 260, fewer between bursts |
  | Summer | Light: soft tufts of dandelion fluff and pollen that glints; dark: small fireflies that wander low over the meadow and glow on and off | 70; 40 |
  | Autumn | Leaves in rust and ochre that sway, tumble edge-on, and turn as they fall                 | 45                    |

  The Scenery menu's Weather hint names the season's effect; Settings names all four.

The prototype bar's second row holds variants to compare, kept in `snowtime.prototypeAuthScene`:

| Variant  | Options                                                                          |
| -------- | -------------------------------------------------------------------------------- |
| Tagline  | Above the card (chosen: in the intro's two colors, as on the signed-in pages), bottom fade (at the foot of the page over a fade, in the page flow so it never covers the card), halo (a glow in the page color), in the card (a footer line), or pill |
| Tone     | Deeper (`#060c14` dark with card `#0d1929`, `#fbfdff` light) or the app's tokens |

Over the images, contrast depends on the picture, so axe's color-contrast results don't apply to
the scene; the card and the tagline's pill keep text on a page-colored surface.

##### Seasonal copy

[seasons.js](seasons.js) holds the copy the sign-in page and the frame share. Every set follows
the winter line's pattern: the season does something, then the timesheet does the same. The
fourth intro line is always "Sign in and get it done!", and the first two are the tagline.

The tagline uses the intro's colors: the first line in the headline color, the second in the
second line's. On light pages the headline colors are too pale, so `titleLight` darkens each hue
to at least 5:1 on the page, tint, and `muted` colors, and the second line is `foreground`.

| Season | Headline, dark (intro) | Headline, light | Second line, dark |
| ------ | ---------------------- | --------------- | ----------------- |
| Winter | `#f4f8fd` (12.7:1)     | `#2265b9`       | `#e6eef8`         |
| Spring | `#cfeccb` (10.7:1)     | `#33722a`       | `#eef5ee`         |
| Summer | `#f6e7a1` (10.9:1)     | `#76630b`       | `#f5f2e4`         |
| Autumn | `#f6c07e` (8.2:1)      | `#94560a`       | `#f3e3d0`         |

Winter's headline is near-white, so in dark mode its tagline barely shows two tones, as in the
intro.

| Season | Lines 1 to 3 (shown)                                                                                   | Alternates (lines 1 and 2; not shown yet)                                                    |
| ------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Winter | Winter is coming. / So is the end of the month. / Before the snow gets deeper, fill in your timesheet. | None                                                                                         |
| Spring | The snow is melting. / So is your memory of last week. / Before it's gone, fill in your timesheet.     | Everything's growing. / So are your unlogged hours.                                          |
| Summer | The days are long. / Your timesheet doesn't have to be. / While the sun's still up, fill it in.        | Summer is here. / Your hours didn't go on holiday.                                           |
| Autumn | The leaves are falling. / So is the end of the month. / Before the last one lands, fill in your timesheet. | The leaves are falling. / So are your unlogged hours. The nights are drawing in. / So is the deadline. |

`seasons.PERIODS` adds taglines for a timesheet period's last days, whatever the season: "It's
Friday. So is the deadline." and "The month is almost out. Your hours shouldn't be." The
alternates and period lines are for the app (task 031, subtask 06); the prototypes don't show
them.

Simulated with fictional rules: the password `wrong` fails sign-in, `taken@example.com` is
already registered, and the short name `snowhound` is taken. Provider, passkey, and email steps
show a short loading state, then continue. Signed-out screens follow the system theme in the
app; the prototype also follows the theme chosen in the signed-in prototypes.

Omitted: two-factor authentication, rate-limit messages, and the real provider consent screens.

Checked in Chromium at 1440, 850, and 390 px, light and dark, every password mode,
and every screen: no horizontal page overflow, validation messages and focus on the first invalid
field, and no browser errors. The scene was checked on 2026-09-24 at 1440 and 390 px, light and
dark: the intro's sequence, skip, replay, and first-visit memory, every variant, the
Settings switches reaching an open sign-in tab, reduced motion, and no browser errors.
