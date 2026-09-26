# 053: Code quality review

Status: todo

Review the repository for style and quality rather than bugs (task 039 covers bugs):
layout, types, comments, leftovers, needless complexity, and rendering cost. The
subtasks go from mechanical checks to ones that need judgement. Task 052's organization
in the URL shows the target for the simplicity review: one structural change that removed
a class of code. Task 045's timer rows show the target for the performance review.

Fix small findings in place. Open a task for any change too big for one commit. Record
areas checked and found sound in the subtask, so a later review can skip them.

## Subtasks

1. [Folder structure](01-folder-structure.md)
2. [Types](02-types.md)
3. [Comments](03-comments.md)
4. [Dead code and leftovers](04-dead-code.md)
5. [Needless complexity](05-complexity.md)
6. [Rendering and loading cost](06-rendering-cost.md)

## Acceptance criteria

- [ ] Every subtask is done
- [ ] Rules worth keeping are enforced by oxlint or a script, or recorded in `AGENTS.md`
