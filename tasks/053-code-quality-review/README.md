# 053: Code quality review

Status: in-progress

Review the repository for style and quality rather than bugs (task 039 covers bugs):
layout, types, comments, leftovers, needless complexity, and rendering cost. The
subtasks go from mechanical checks to ones that need judgement. Task 052's organization
in the URL shows the target for the simplicity review: one structural change that removed
a class of code. Task 045's timer rows show the target for the performance review.

The review must leave the code no larger or more complex than it found it. Changes that
remove or simplify code need no approval, however large, as long as every requirement in
`docs/product.md` and `docs/architecture.md` still holds and the tests pass. Ask before
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

- [ ] Every subtask is done
- [ ] `src/` has no more lines than at the start, apart from fixes agreed first. The
      baseline on 2026-09-26 (`4169a08`) is 25,962 lines of `.ts`, `.tsx`, and `.css`,
      counted without `routeTree.gen.ts` and `src/components/ui/`:
      `git ls-files src | grep -vE 'routeTree.gen|components/ui/' | grep -E '\.(ts|tsx|css)$' | xargs cat | wc -l`
- [ ] Rules worth keeping are enforced by oxlint or a script, or recorded in `AGENTS.md`
