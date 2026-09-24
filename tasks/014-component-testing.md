# 014: Component testing

Status: in-progress

Set up Vitest with `@solidjs/testing-library` for UI component tests, once real
components exist. Server and database code stays on `bun test`.

## Acceptance criteria

- [x] Vitest, `@solidjs/testing-library`, `@testing-library/jest-dom` and a DOM
      environment (jsdom or happy-dom) installed
- [x] Vitest config reuses the Solid plugin from `vite.config.ts`
- [x] The two runners never pick up each other's files: a naming or folder rule
      (for example `*.test.tsx` for Vitest, `*.test.ts` for `bun test`) enforced in both
      configs
- [x] `bun run test` runs both suites; separate scripts run each one
- [ ] One test of a real component (for example the timer control) passes (task 023,
      timer)
- [x] The testing split recorded in `docs/architecture.md`
- [x] CI runs both suites (task 009)
