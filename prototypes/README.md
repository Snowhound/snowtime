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
| [app-frame.js](app-frame.js)             | App frame, user settings, icons, and markup helpers         |
| [app-data.js](app-data.js)               | Shared fictional organization, generated entries, zone helpers |
| Inline Lucide SVG paths                  | Icons, copied from `lucide-static` (pinned)                 |

Dependency order in `<head>`:

```html
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3"></script>
<script src="prototype-theme.js"></script>
<script src="ui.js"></script>
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
| `popover`                                     | `PopoverContent`               | native `[popover]` + `popovertarget`; `ui.js` places it under the trigger |
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
  feature styles in the HTML. When `src/styles.css` tokens change, update `prototype.css`.
- Keep each view in its own HTML file. The app frame is the shared exception, so every
  signed-in page has the same header; see [App frame](#app-frame).

## App frame

[app-frame.js](app-frame.js) renders the signed-in chrome. Call
`appFrame.mount({ page, title })` first in the page script. It inserts:

- A dashed **prototype bar** with the page title, the page's own controls (move them in with a
  `<div id="prototype-controls">`), and a role switcher (member, team lead, admin, owner).
- The **app header**: the clock mark, the organization switcher (a dropdown menu of the user's
  organizations), navigation (Timer, Reports, Projects, and Organization for admins and owners
  only), and a user menu (Profile, Settings, theme, Sign out). Below 768 px the navigation moves
  to a second header row of four equal-width links, so every page stays one tap away without a
  hamburger menu.

It also provides:

| API                                  | Use                                                            |
| ------------------------------------ | -------------------------------------------------------------- |
| `appFrame.settings.get()` / `.set(patch)` / `.reset()` | The user's settings: `locale`, `timeZone`, `weekStart`, `theme`, `design` (timer layout), `showSummary`. The app stores them in `user_settings`; the prototypes keep them in `localStorage` under `snowtime.prototypeSettings`. `set` saves, applies the theme, and notifies. |
| `appFrame.on('settings' \| 'role' \| 'org', fn)` | Re-render when settings, the prototype role, or the organization change |
| `appFrame.role`, `appFrame.isAdmin()`, `appFrame.org`, `appFrame.user` | Prototype session |
| `appFrame.setUser(patch)`            | Swap the header's user, for long-content fixtures              |
| `appFrame.link(href)`                | A link that keeps `?role=` and `?org=`                         |
| `appFrame.escapeHtml`, `appFrame.icon(name)`, `appFrame.initials` | Markup helpers; `icon` uses the Lucide sprite the frame injects |

The role and organization live in the URL (`?role=admin&org=snowhound`) so they survive moving
between prototypes. Frame links with `data-frame-link="<href>"` keep them. Switching the
organization changes the header only; page data stays the same fictional Snowhound data. The
signed-in user is Anna Kask (`anna@snowhound.eu`), matching the invitation in `auth.html`.

[app-data.js](app-data.js) holds the fictional Snowhound organization: nine members, three teams
(Platform, Design, Client services) with leads, the timer's projects plus an archived one, and
about ten weeks of generated entries in Tallinn time, including a few that cross midnight and
Anna's running timer. `appData.organization({ role, long })` returns fresh copies; as team lead,
Anna leads Platform. `appData.tz` computes day and week starts in any IANA zone, DST included.

Project colors come from eight categorical slots (`--series-1` to `--series-8` in
[prototype.css](prototype.css)), validated for lightness, chroma, and color-vision separation on
the light and dark surfaces. `project.color` stores the light hex, and dark mode uses each slot's
dark step. Light mode's yellow, aqua, and magenta are below 3:1 against the surface, so charts
always carry a legend or labels and a table view.

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
| Preferences | `user_settings`   | Language, time zone, week start, theme, timer layout, show summary; each saves on change |
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

The timer's gear popover stays as a shortcut to the appearance fields, with an "All settings"
link. It, this page, and the user menu's theme items write through `appFrame.settings`, so they
never disagree; other open tabs follow through the `storage` event.

Fixtures: populated (Google and GitHub), new account (one provider; resets preferences to the
defaults with the browser's zone), long content (long name and email), and local dev password
(only the seeded credential account).

Omitted: avatar upload, email change, account deletion (users are anonymized, not deleted), and
active sessions.

Checked in Chromium at 1440, 850, and 390 px, light and dark, every fixture, as member and owner:
no horizontal page overflow, settings shared with the timer and reports across pages, menu focus
and Escape, and no browser errors.

### [timer.html](timer.html) — Timer and entries

Decision: layout of the main tracking view (running timer plus recent entries). All three layouts
are kept as user-selectable options.

- **Bar**: Toggl-style single-line timer; entries grouped by day in cards with day totals.
- **Focus**: large clock, "continue recent" chips, and a compact day list.
- **Table**: dense table with day subtotal rows; scrolls horizontally inside its container on
  narrow screens.

The settings button opens a **View** popover: layout, theme (light / dark / system), and whether
the summary panel (today / this week, per-project bars) is shown, plus a link to Settings.
These are user settings, saved through the app frame (`user_settings` in the app).

Entries are edited in a dialog opened from the pencil action or the time range: description,
project, date, start, and end. An end time at or before the start means the next day. Clicking the
running timer's clock edits the running entry's start date and time. Validation: all times
required, no entry ending in the future, no running entry starting in the future; a live line
shows the resulting duration.

Simulated: start/stop, Enter to start, editing the running entry inline or in the dialog, continue
(stops any running timer first), delete, edit. Fixtures: running, idle, long content, empty. Day
totals count stopped entries only; the summary includes the running timer. Entries are grouped by
their start day; splitting at midnight belongs to reports.

Omitted: overlap checks between entries, manual entry, reports, persistence of entries.

Checked in Chromium at 1440, 850, and 390 px, light and dark, all layouts with summary on and off:
no horizontal page overflow, settings survive reload, dialog validation and saving work, no browser
errors.

### [auth.html](auth.html) — Sign-in flows

Decision: layout of the signed-out screens, and how the sign-in methods in
`docs/architecture.md` ("Sign-in methods") appear on them.

- **01 · Card**: the form in a centered card on a muted background. Selected for the app.
- **02 · Split**: a dark brand panel beside the form on wide screens; kept for comparison.

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

The tagline "Winter is coming." sits in the split layout's brand panel and under the card in the
card layout. A clock icon stands in for a logo; a logo is postponed (task 017).

Simulated with fictional rules: the password `wrong` fails sign-in, `taken@example.com` is
already registered, and the short name `snowhound` is taken. Provider, passkey, and email steps
show a short loading state, then continue. Signed-out screens follow the system theme in the
app; the prototype also follows the theme chosen in the signed-in prototypes.

Omitted: two-factor authentication, rate-limit messages, and the real provider consent screens.

Checked in Chromium at 1440, 850, and 390 px, light and dark, both layouts, every password mode,
and every screen: no horizontal page overflow, validation messages and focus on the first invalid
field, and no browser errors.
