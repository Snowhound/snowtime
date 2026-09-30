# 053: Code quality review

Status: done

Review the repository for style and quality rather than bugs (task 039 covers bugs):
layout, types, comments, leftovers, needless complexity, and rendering cost. The
subtasks go from mechanical checks to ones that need judgement. Task 052's organization
in the URL shows the target for the simplicity review: one structural change that removed
a class of code. Task 045's timer rows show the target for the performance review.

The review must leave the code no larger or more complex than it found it. Changes that
remove or simplify code need no approval, however large, as long as every requirement in
`docs/product.md` and `docs/architecture/` still holds and the tests pass. Ask before
any fix that adds a meaningful amount of code, such as a new abstraction, helper module,
or dependency. Record areas checked and found sound in the subtask, so a later review can
skip them.

## Subtasks

1. [Folder structure](01-folder-structure.md)
2. [Types](02-types.md)
3. [Comments](03-comments.md)
4. [Dead code and leftovers](04-dead-code.md)
5. [Needless complexity](05-complexity.md)
6. [Rendering and loading cost](06-rendering-cost.md)

## Acceptance criteria

- [x] Every subtask is done
- [x] `src/` has no more lines than at the start, apart from fixes agreed first. The
      baseline on 2026-09-26 (`4169a08`) is 25,962 lines of `.ts`, `.tsx`, and `.css`,
      counted without `routeTree.gen.ts` and `src/components/ui/`:
      `git ls-files src | grep -vE 'routeTree.gen|components/ui/' | grep -E '\.(ts|tsx|css)$' | xargs cat | wc -l`.
      After subtask 06 it is 25,862.
- [x] Rules worth keeping are enforced by oxlint or a script, or recorded in `AGENTS.md`

## Findings

Rules checked on 2026-09-26, and what holds each one:

- oxlint: import paths within and between areas, `function` declarations, no `any` or
  `@ts-ignore` (subtask 02), and Solid's reactivity rules. It now also allows imports
  from `src/features/` only in routes and `src/router.tsx`, which `AGENTS.md` stated but
  nothing checked.
- Scripts in `bun run test` and CI: icon names (`icons:check`), unused files and exports
  (`knip`, subtask 04), and the data model diagram (`datamodel:check`).
- TanStack Start's import protection keeps `*.server.ts` out of the client bundle.
- `AGENTS.md` only: feature folders, route files, pending components, comments, and a
  reason on every inline lint disable. The one disable without a reason after `--` now has
  one.
