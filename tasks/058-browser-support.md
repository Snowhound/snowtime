# 058: Supported browsers

Status: done

The app supports evergreen browsers, but nothing recorded which, or told a visitor on an older
browser why a page breaks. Older browsers that still have what the app uses should work
without a warning; ones that lack it should say so.

## Acceptance criteria

- [x] `docs/architecture.md` ("Supported browsers") records the supported browsers, the last
      two major versions of Chrome, Edge, Firefox, and Safari, and why older capable ones get
      no notice
- [x] Vite's build target stays Baseline Widely Available, and features the TypeScript `lib`
      allows beyond it are in the browser check's list
- [x] A browser without a feature the app needs sees a notice that names the supported
      browsers, before a failure it would otherwise hit. The check tests features, not
      user-agent strings, is ES5, and the page still loads.
- [x] The notice is translated, dismissable for the session, and checked per
      `docs/skills/ui-review/SKILL.md`

## Findings

Checked on 2026-09-27 in the dev app with agent-browser, with an init script that makes
`CSS.supports('selector(:has(a))')` false, as in Firefox before 121. The notice showed on the
sign-in page at 1440 and 390 px, with no horizontal overflow. Dismiss hid it, and it stayed
hidden on reload in the same session. The frames' fixed scene first covered it, since the
frames are stacking contexts, so it has its own layer at `z-index: 70`, above the intro (60).
A normal Chrome didn't show it.
