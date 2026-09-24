---
name: ui-review
description: Drive a real browser with the agent-browser CLI to build, inspect, and verify Snowtime UI — HTML prototypes under prototypes/ and the local dev app. Use whenever a task needs to see, screenshot, or interact with a page instead of only reading code, and prefer it over ad-hoc Playwright scripts.
---

# UI review with agent-browser

`agent-browser` is a CLI that drives Chrome. Prefer it over one-off Playwright scripts for visual
checks.

## Before you start

```bash
agent-browser --version || npm install -g agent-browser   # ask the user before installing
agent-browser install                                     # first run only: downloads Chrome for Testing
```

Use a named session (`--session <name>`) so parallel work stays isolated, and close only your own
session when done (`agent-browser --session <name> close`). Never `close --all`.

## Targets

### Prototypes (no server)

```bash
agent-browser --session proto open "file://$PWD/prototypes/timer.html"
```

Follow [`prototypes/README.md`](../../../prototypes/README.md) for how prototypes are built; this
skill only covers driving them.

### Local dev app

The dev server is the user's. Check whether it is up; do not start or kill it unless asked:

```bash
curl -sf -o /dev/null http://localhost:3000 && echo up || echo down
```

If it is down, ask the user to run `bun --bun run dev`. There is no dev login shortcut yet; sign
in with a local test account the user provides.

## Review loop

1. Open the page.
2. `agent-browser snapshot -i -c` for structure and element refs (`@e3`).
3. `agent-browser screenshot <scratch>/ui.png`, then actually look at the image.
4. Interact with the controls the change touches: selects, dialogs, popovers, timer controls.
5. `agent-browser errors` and `agent-browser console` — a page that looks right but throws is not
   done.
6. If asked to improve the UI: edit, `agent-browser reload`, repeat. Stop when no meaningful issue
   remains.

Write screenshots and scratch scripts to the session scratch directory, never into the repo.

## What to check

- Visual hierarchy, spacing, alignment, consistency with Solid-UI components.
- No horizontal page scroll: `agent-browser eval "document.documentElement.scrollWidth"` equals the
  viewport width. To find the culprit, list elements whose `getBoundingClientRect().right` exceeds
  the viewport.
- Empty, populated, long-content, validation, disabled, loading, and error states.
- Keyboard access, focus visibility, Escape behavior; `agent-browser a11y --tags wcag2a,wcag2aa`
  for an axe-core pass.
- Light and dark mode.
- Screenshots after transitions settle (button color changes and dialogs animate).

## Responsive and theme

```bash
agent-browser set viewport 1440 900 1
agent-browser set viewport 850 900 1
agent-browser set viewport 390 844 2
agent-browser eval "document.documentElement.classList.toggle('dark')"
```

Dark mode is class-based (`.dark` on the root). Prefer the page's own theme toggle when present.

## Data

Prototypes use fictional data only. For the dev app, use test accounts; do not paste session
cookies, auth tokens, or other users' time entries into the transcript, commits, or files, and do
not commit app screenshots.

## Useful extras

```bash
agent-browser find role button click --name "Start"      # semantic locators
agent-browser find role option click --name "Empty"      # Basecoat select options
agent-browser get styles "<sel>"                          # computed styles
agent-browser network requests --status 400-599           # failed calls
agent-browser diff screenshot --baseline before.png       # before/after visual diff
```
