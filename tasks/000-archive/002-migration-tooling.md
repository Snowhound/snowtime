# 002: Migration tooling

Status: done

SQL-first, roll-forward migrations with Drizzle v1 as runner and query layer. See
`docs/migrations.md`.

## Acceptance criteria

- [x] Drizzle v1 rc and `@libsql/client` installed, exact versions pinned
- [x] `db:generate`, `db:migrate`, `db:verify`, `db:drift` scripts
- [x] Snapshots removed by `db:generate`; applied-migration checksums verified

CI wiring moved to `009-ci-and-environments/`; the DBML generator to `010-dbml-generator.md`.
