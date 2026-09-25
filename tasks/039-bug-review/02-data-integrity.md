# 02: Data integrity

Status: todo

Server checks that read and then write can race, as the 24-hour entry bug showed. Rules
that must always hold belong in the database; caps can stay approximate
(`docs/architecture.md`, "Limits").

## Acceptance criteria

- [ ] Each check-then-write in `src/server/` is listed with what a concurrent write can
      break, and each invariant is enforced by a constraint, trigger, transaction, or
      conditional write
- [ ] One running timer per user holds across organizations, including when a member is
      removed while their timer runs
- [ ] Soft-deleted rows never count in unique indexes, caps, lists, or reports, and
      references to them (archived or deleted projects, deleted teams) behave as
      documented
- [ ] Composite foreign keys keep entries, projects, and teams in one organization
- [ ] Each migration in `drizzle/` stays backward compatible with the previous app
      version (`docs/migrations.md`), and `schema.ts` matches it, including partial
      index `WHERE` clauses the drift check can't see
