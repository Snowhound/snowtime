# 058: Supported browsers

Status: todo

The app supports evergreen browsers: current Chrome, Edge, Firefox, and Safari, desktop and
mobile. Nothing records that yet, or tells a visitor on an older browser why a page breaks.
`tsconfig.json` type-checks against ES2023 (raised from ES2022 in task 055, for
`toSorted`), and Vite builds for its default target, Baseline Widely Available. A floor from
2023 is older than the app needs.

## Acceptance criteria

- [ ] `docs/architecture.md` records the supported browsers as a rolling window with the
      usual slack, such as the last two major versions of each, or Baseline Widely
      Available, and why
- [ ] Vite's `build.target` and the TypeScript `target` and `lib` follow that window, so
      code may use what those browsers support without a polyfill
- [ ] A browser outside the window sees a notice that names the supported browsers, before
      a failure it would otherwise hit. The check tests features, not user-agent strings,
      and the page still loads when it can.
- [ ] The notice is translated and checked per `docs/skills/ui-review/SKILL.md`
