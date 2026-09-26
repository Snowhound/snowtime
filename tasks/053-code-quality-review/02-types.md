# 02: Types

Status: done

A loose type at a module's boundary spreads to every caller. Inside a function it only
costs that function.

## Acceptance criteria

- [x] No `any` in exported signatures, props, or query and server function results;
      `unknown` or a precise type replaces it
- [x] Each remaining `any`, `as` cast, non-null `!`, and `@ts-expect-error` is needed
      and has a reason, or goes
- [x] Types derive from one source (the Drizzle schema, Valibot schemas, server
      function return types) rather than being restated by hand
- [x] oxlint enforces what's decided, for example `typescript/no-explicit-any`

## Findings

Changed:

- oxlint now errors on `typescript/no-explicit-any`, `ban-ts-comment`,
  `no-unnecessary-type-assertion`, `no-extra-non-null-assertion`, and
  `no-non-null-asserted-optional-chain`. The code already passed all five.
  `no-unsafe-type-assertion` stays off: it flags every narrowing cast, including the
  ones listed below.
- `SocialProvider`, written out in `sign-in-methods.tsx` and `sign-in-methods-list.tsx`,
  derives from the server's `SignInMethod`.
- `WeekStart` comes from the settings schema; `src/lib/calendar.ts` re-exports it rather
  than restating `'mon' | 'sun'`.
- `CreatedInvitation` in `invite-dialog.tsx` is a `Pick` of `Invitation`.
- The day lists hold `StoppedEntry` (an `Entry` with a `stoppedAt`), and `readEntryTimes`
  returns a non-null `stoppedAt` for `running: false`, so the entry editor and the
  all-time total no longer assert it. The one left, in `timer-view.tsx`, saves a new
  entry from the popover, whose values type covers the running entry too.
- One `isAdmin` in `src/lib/session.ts` replaces two copies and two inline checks
  (agreed on 2026-09-26, ahead of subtask 04).

Checked and sound:

- No `any`, `@ts-ignore`, or `@ts-expect-error` in `src/`, `scripts/`, or `datamodel/`.
- `unknown` appears only where callers ignore a result (`Promise<unknown>`), for parsed
  input (`JSON.parse`, form errors), and inside `cacheUpdate`, which erases each cache's
  type behind a typed wrapper.
- Query types derive from server function results (`Member`, `Team`, `Project`,
  `Report`, `Entry`, `AppSession`, `Settings`); settings, roles, and filters derive from
  Valibot schemas or `as const` lists. The Better Auth mutation inputs in
  `features/organization/queries.ts` describe client calls, not server schemas.
- `as` casts in app code fall into these groups, each needed:
  - DOM: event targets, `activeElement`, `firstElementChild`, `dataset` values.
  - Select and toggle values read back as the union their options came from
    (`OrgRole`, `TeamRole`, settings fields, filter-bar values, tabs).
  - `useMutationState` variables, which TanStack types as `unknown`.
  - Library gaps with a comment: the router's nonce, Better Auth's hook result, and the
    error page's missing `reset` on the server.
  - Widening a default (`'member' as OrgRole`, `[] as string[]`), `Object.keys`, and
    `includes`/`indexOf` on `as const` lists.
  - A computed key in `reports.server.ts` and the uniform map in `weather.ts`, which
    TypeScript can't type.
- Test files cast fixtures (`as never`, `as Member[]`) and assert non-null freely: a
  wrong guess fails the test.
- Non-null `!` in app code, on about 20 lines, each follow a guard TypeScript can't see:
  a Solid accessor called again after a check (`device()!`, `user()!` under its `Match`),
  refs set in JSX, lookups after a `has`/filter (`teams-tab.tsx`), `find` on constant
  tables (`app-icon.ts`, `scene.ts`), and Drizzle's `and()` with fixed arguments.
  `session.settings` is null until `getSettings` creates the row with the browser's time
  zone, so the Projects and Reports pages assert `settings!` under a `Show` that checks it.
