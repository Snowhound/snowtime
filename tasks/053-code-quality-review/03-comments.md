# 03: Comments

Status: todo

Keep comments minimal: one earns its place only where the code is hard to follow without
it, and then says only the relevant part. History belongs in git.

## Acceptance criteria

- [ ] No comment describes an earlier version, the change that introduced the code, or
      a mock-up it came from ("The mock-up divided x by the aspect ratio…")
- [ ] No comment restates what the next line plainly does
- [ ] Long header comments are cut to what a reader of that file needs; cross-references
      to prototypes and docs stay only where they help
- [ ] A file where most lines need a comment is a sign the code is harder than it should
      be: simplify the code first (with subtask 05), then cut what it no longer needs
      explained. For example, `src/server/middleware.ts` spends 8 of its 45 lines on a
      header that lists what each middleware does, and 4 more on why the scope validator
      works around Start's input merging
- [ ] The comment guidance in `AGENTS.md` says the above

## Findings
