---
name: ui-review
description: Drive a real browser with the agent-browser CLI to build, inspect, and verify Snowtime UI — HTML prototypes under prototypes/ and the local dev app. Use whenever a task needs to see, screenshot, or interact with a page instead of only reading code, and prefer it over writing ad-hoc Playwright scripts.
---

# UI review with agent-browser

`agent-browser` is a single CLI that drives Chrome. Any agent that can run shell commands can use it,
so prefer it over writing one-off Playwright scripts for visual checks. Reserve Playwright for
committed e2e specs, if the project adds them.

## Before you start

```bash
agent-browser --version || npm install -g agent-browser   # ask the user before installing
agent-browser install                                     # first run only: downloads Chrome for Testing
```

If the CLI cannot be installed, fall back to Playwright (`bunx playwright`), and say in the handoff
that you did. When its expected browser revision is missing but local Chrome is available,
`chromium.launch({ channel: 'chrome', headless: true })` can use it.

Sandboxed agents may be denied localhost sockets or browser launch with `Operation not permitted`.
That is a sandbox restriction, not a missing dependency — rerun with elevated approval.

Use a named session (`--session <name>`) to keep parallel work isolated. Close only your own
session (`agent-browser --session <name> close`); never `close --all`, which also kills sessions
belonging to other work.

## Two targets

### 1. Prototypes (no server)

Prototype HTML under `prototypes/` opens directly from disk:

```bash
agent-browser open "file://$PWD/prototypes/timer.html"
```

CDN dependencies (Tailwind browser runtime, tailwind-merge) need internet access. Follow
[`prototypes/README.md`](../../../prototypes/README.md) for how prototypes are built; this skill
only covers driving them.

### 2. Local dev app

**The dev server is the user's, not yours.** Check, do not manage:

```bash
curl -sf -o /dev/null http://localhost:3000 && echo up || echo down
```

If it is down, ask the user to start it (`bun --bun run dev`) and wait. Do not run it yourself
unless they say to, and never `pkill` a dev server. Check the port in `package.json` before
assuming 3000.

Client-rendered views can legitimately snapshot as `(no interactive elements)` right after `open`.
Wait for a visible control or another readiness condition before snapshotting. Prefer
`wait <selector>`, `wait --text`, or `wait --fn`; use `wait --load networkidle` only for pages known
to become quiet, since polling can prevent it from resolving. Do not read an immediate empty
snapshot as a broken page.

There is no dev login shortcut yet; sign in with a local test account the user provides. Session
cookies survive within one agent-browser session, so log in once and keep navigating. Take a fresh
`snapshot -i -c` and click real refs if an accessible name does not match.

A page that loads but shows empty lists or failing calls usually means the database or auth state
is off, not that the UI is broken — check `network requests --status 400-599` before editing
components.

## Review loop

1. Open the page (prototype file or dev route).
2. `agent-browser snapshot -i -c` for interactive structure and element refs (`@e3`).
3. `agent-browser screenshot <scratch>/ui-review.png --annotate`, then actually look at the image.
4. Interact with the controls the change touches: dialogs, popovers, selects, disclosures, tabs,
   timer controls.
5. `agent-browser console` and `agent-browser errors` — a page that looks right but throws is not
   done. See **Debugging a broken page** below when something is actually broken.
6. If asked to improve the UI: edit the implementation, `agent-browser reload`, repeat. Stop when no
   meaningful issue remains; do not redesign for its own sake.

Write screenshots and scratch scripts to the session scratch directory, never into `prototypes/`,
`public/`, or the repository root.

## Debugging a broken page

agent-browser drives real Chrome, so an exception it reports is a genuine Chromium exception with a
real stack. Use it to debug, not only to look. For the dev app, start with request metadata (method,
status, route) and error classes. Do not print cookies, auth headers, or full response bodies; if
detailed inspection is necessary, extract only the relevant fragment and redact before output.

```bash
agent-browser errors                              # uncaught exceptions with stacks
agent-browser console                             # log/warn/error/info, in order
agent-browser console --clear                     # clear console before reproducing
agent-browser errors --clear                      # clear exceptions before reproducing
agent-browser network requests --status 400-599   # failed calls
agent-browser eval "<js>"                         # poke at page state
agent-browser inspect                             # open DevTools on the page for a manual look
```

Things worth knowing:

- TanStack Start renders on the server first. Server functions and loaders can fail server-side
  regardless of what the browser shows, so also check the dev-server output the user shares.
- Vite's dev error overlay renders in shadow DOM and can be missed by `snapshot`. If the page looks
  blank, check `errors` before assuming a CSS problem.
- Dev builds serve source maps, so stacks point at `.tsx` and `.ts` sources. Quote the file and
  line, not a bundled chunk offset.

Clear console and errors, reproduce deliberately, then read — a page that has been clicked around
for five minutes has a log full of noise unrelated to the bug.

## What to check

- Visual hierarchy, spacing, alignment, typography consistency with the Solid-UI components.
- Overflow and clipping — no horizontal page scroll; use the _content_ width, not the viewport.
  `agent-browser eval "document.documentElement.scrollWidth"` should equal the viewport width; to
  find the culprit, list elements whose `getBoundingClientRect().right` exceeds it.
- Empty, populated, long-content, validation, disabled, loading, and error states.
- Dialogs, popovers, and dropdowns: open and closed, keyboard focus containment, Escape behavior,
  focus returning to the trigger.
- Keyboard access and obvious accessibility problems; `agent-browser a11y --tags wcag2a,wcag2aa`
  for an axe-core pass.
- Light and dark mode.

Inspect screenshots after transitions settle — a shot taken right after closing a dialog or
switching a button variant can still contain the transition and misrepresent the result.

## Responsive and theme

Unless the task is explicitly desktop-only, check desktop and narrow viewports. Prototypes are
verified at 1440, 850, and 390 px:

```bash
agent-browser set viewport 1440 900 2
agent-browser set viewport 850 900 1
agent-browser set viewport 390 844 2
```

Dark mode is class-based (`.dark` on the root). Toggle it with the page's own theme control when
one is present, otherwise:

```bash
agent-browser eval "document.documentElement.classList.toggle('dark')"
```

`agent-browser set media dark` only changes the emulated OS preference.

## Handling data

- Prototypes use fictional data; their screenshots are safe to discuss.
- In the dev app, use test accounts only. Do not paste session cookies, tokens, or other people's
  time entries into the transcript, commit messages, or files, and do not commit app screenshots.
- Avoid actions that mutate shared state (the `staging` database, other tenants' data) unless the
  task asks for it.

## Useful extras

```bash
agent-browser find role button click --name "Start"      # semantic locators, no CSS needed
agent-browser select "#fixture" long                      # native <select>
agent-browser get styles "<sel>"                          # check computed styles instead of guessing
agent-browser network requests --type xhr,fetch           # see what the page actually called
agent-browser diff screenshot --baseline before.png       # before/after visual diff
agent-browser --session <name> close                      # release your own session only
```

Always use `snapshot` for structure and screenshots for visual judgement; neither alone is enough.
