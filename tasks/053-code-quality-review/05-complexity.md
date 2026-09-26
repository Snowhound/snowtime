# 05: Needless complexity

Status: todo

Look for code that exists only to support a design choice that could change, as the
shared active organization did before task 052. Such a change removes more code than
any local cleanup.

## Acceptance criteria

- [ ] Wrappers, factories, options, and generic helpers with a single caller or a
      single variant are inlined
- [ ] State kept in two places (URL and signal, query cache and store, server and
      client) has one source, or a stated reason for both
- [ ] Each server domain's layers (`*.functions.ts`, `*.server.ts`, schemas) carry
      their weight; none only forwards to the next
- [ ] Larger simplifications are done, split into reviewable commits, with the
      decisions they change updated in `docs/architecture.md`

## Findings

Candidates from earlier subtasks:

- `team-dialog.tsx` and `project-dialog.tsx` repeat the dialog shell that keeps the last
  target while it animates closed, and the name field with its uniqueness check (subtask
  04, found by `jscpd`). A shared component would be a new abstraction, so it needs
  agreement first.
- `parseOrganizationInput` in `src/server/schemas.ts` has one caller, `scopeMiddleware`, and
  a test of its own. Inlining it would put the Valibot check in the middleware (subtask 03).
