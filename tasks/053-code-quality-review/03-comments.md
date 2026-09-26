# 03: Comments

Status: done

Keep comments minimal: one earns its place only where the code is hard to follow without
it, and then says only the relevant part. History belongs in git.

## Acceptance criteria

- [x] No comment describes an earlier version, the change that introduced the code, or
      a mock-up it came from ("The mock-up divided x by the aspect ratio…")
- [x] No comment restates what the next line plainly does
- [x] Long header comments are cut to what a reader of that file needs; cross-references
      to prototypes and docs stay only where they help
- [x] A file where most lines need a comment is a sign the code is harder than it should
      be: simplify the code first (with subtask 05), then cut what it no longer needs
      explained. For example, `src/server/middleware.ts` spends 8 of its 45 lines on a
      header that lists what each middleware does, and 4 more on why the scope validator
      works around Start's input merging
- [x] The comment guidance in `AGENTS.md` says the above

## Findings

Changed:

- History: the two "mock-up" comments in `weather.ts`, "Like the prototype" in
  `entry-popover.tsx`, and the task numbers of finished tasks (015, 029, 034) in
  `schema.ts`, `app-icon.ts`, and `export.ts` are gone.
- `src/server/middleware.ts`: the 8-line header listing both middlewares became a
  2–3 line comment on each, and the 4 lines on Start's input merging became one sentence.
  `schemas.ts` already says why the input passes through unchanged. 12 comment lines are
  now 5; the code needed no change.
- `src/lib/queries/query.ts`: `optimistic()` took one cache or a list. Only the settings
  mutation passed one cache, so it now passes a list too; the other branch and its 8-line
  usage example are gone. A small code change that removes code, so it's done here rather
  than in subtask 05.
- Headers cut to what a reader needs: `timer-view.tsx` and `timer-bar.tsx` (which described
  each layout's classes), `entry-list.tsx`, `entry-fields.tsx`, `appearance-popover.tsx`,
  and `src/lib/form.ts` (a 10-line usage example for a 6-line helper).
- Comments that repeated a function's name (`useDurationFormat`, `useFormatHours`,
  `introLines`, "Helpers of the Projects view") are gone.
- Comment blocks that ran past 100 columns after earlier path changes are rewrapped, in their
  own commit.
- `AGENTS.md` has a comment rule: comment only where the code is hard to follow without it,
  no restating or history, short headers, and simplify before explaining.

Checked and sound:

- A search for history wording ("used to", "previously", "no longer", "originally",
  "replaced", task numbers) finds only current behavior, apart from the lines above. Task
  054 is cited because it is open.
- The ~120 one-line comments of 45 characters or less: apart from those above, each adds
  a unit, an order, an edge case, or a reason the name doesn't carry.
- Headers of 4 or more lines (43 files): the rest describe a contract callers need (the
  date and time fields' `onChange` and `onCommit`, the intro's triggers), a security or
  platform reason (`invitations.server.ts`, `locale-cookie.ts`, `error-page.tsx`,
  `row-activation.ts`), or a decision with its reason (Kobalte's Combobox not being used).
  Prototype references stay in view headers: they point to the design a change should
  match.
- Comment density: no file outside the tests is over 30% comments. `query.ts` (now lower)
  and `session.ts` document shared cache behavior that several features rely on.
- `src/styles.css`: its 29 comment lines name what each block styles, with no history.
