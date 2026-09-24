# 002: Migration tooling

Status: in-progress

SQL-first, roll-forward migrations with Drizzle v1 as runner and query layer. See
`docs/migrations.md`.

## Acceptance criteria

- [x] Drizzle v1 rc and `@libsql/client` installed, exact versions pinned
- [x] `db:generate`, `db:migrate`, `db:verify`, `db:drift` scripts
- [x] Snapshots removed by `db:generate`; applied-migration checksums verified
- [ ] CI: `db:verify` + `db:migrate` against staging on PRs, prod on merge to main
- [ ] CI: `db:drift` as a non-blocking warning
- [ ] Script to regenerate `docs/data-model/snowtime.dbml` from `src/db/schema.ts`
