# 003: Initial migration

Status: done

Turn the signed-off DBML (task 001) into migration 0001 and the matching Drizzle
schema. Follow `docs/migrations.md`.

## Acceptance criteria

- [x] `bun run db:generate initial_schema` with Better Auth and app tables, indexes,
      `CHECK`s and composite foreign keys
- [x] Audit columns and `updated_at` triggers per `docs/migrations.md`; confirm the
      drift check accepts the expression defaults as written in `schema.ts`
- [x] Better Auth tables cross-checked against the 1.7.5 plugin schema source
- [x] `src/db/schema.ts` and relations match; `bun run db:drift` reports no changes
- [x] Applies cleanly to an empty database (`rm local.db && bun run db:migrate`)
- [x] DBML updated for anything that changed while writing the SQL
- [x] `src/db/schema.test.ts` runs the migrations and checks audit columns, the
      trigger fallback, composite foreign keys and the running-timer index
