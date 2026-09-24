# 003: Initial migration

Status: todo

Turn the signed-off DBML (task 001) into migration 0001 and the matching Drizzle
schema. Follow `docs/migrations.md`.

## Acceptance criteria

- [ ] `bun run db:generate initial_schema` with Better Auth and app tables, indexes,
      `CHECK`s and composite foreign keys
- [ ] Audit columns and `updated_at` triggers per `docs/migrations.md`; confirm the
      drift check accepts the expression defaults as written in `schema.ts`
- [ ] Better Auth tables cross-checked against `@better-auth/cli generate` output
- [ ] `src/db/schema.ts` and relations match; `bun run db:drift` reports no changes
- [ ] Applies cleanly to an empty database (`rm local.db && bun run db:migrate`)
- [ ] DBML updated for anything that changed while writing the SQL
