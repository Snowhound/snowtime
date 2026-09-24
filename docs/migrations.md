# Database migrations

Read this before changing the schema. The why is in `architecture.md` ("Schema and
migrations"); this is the how.

## Workflow

```bash
bun run db:generate <name>   # new empty drizzle/<timestamp>_<name>/migration.sql
bun run db:migrate           # verify applied migrations, then apply pending ones
bun run db:drift             # warn if src/db/schema.ts no longer matches the migrations
bun run db:verify            # only check that applied migrations are unchanged
```

1. `bun run db:generate <name>` (snake_case). Never create the folder or pick the
   timestamp yourself.
2. Write the SQL. Separate statements with `--> statement-breakpoint`.
3. `bun run db:migrate` against the local database (`file:local.db`, from
   `.env.development`).
4. Update `src/db/schema.ts` (and relations) by hand to match.
5. `bun run db:drift` must report no changes.
6. Until the DBML generator exists, update `docs/data-model/snowtime.dbml` too.

Target another database by setting `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, e.g. in the
gitignored `.env.local`. Never put tokens in tracked env files.

## Rules

- **Roll forward only.** No down migrations. Fix a mistake with a new migration.
- **Never edit or delete an applied migration.** `db:migrate` refuses to run if you do.
  An unmerged migration that has only run on your local database may still be edited;
  delete `local.db` and migrate again.
- **Backward compatible where possible.** The previous app version keeps running against
  the migrated database until the deploy is promoted: add before you remove, and split
  renames into add, backfill, switch, drop.
- **Never run `drizzle-kit generate` without `--custom`, or `drizzle-kit push`,** against a
  real database. `schema.ts` follows the database, not the other way round.

## SQL conventions

These keep the drift check accurate; the spike behind them is summarized in
`architecture.md`.

- Tables: singular `snake_case`. Primary keys `text` (UUIDv7).
- Timestamps: `integer` epoch milliseconds, UTC. In `schema.ts`:
  `integer('x', { mode: 'timestamp_ms' })`.
- Booleans: `integer` with `CHECK (x IN (0, 1))`; defaults as `0`/`1`, and in
  `schema.ts` `` .default(sql`0`) `` rather than `.default(false)`, or drift reports a
  false difference.
- Unique constraints: a named `CREATE UNIQUE INDEX`, never inline `UNIQUE (...)`, which
  introspection cannot see.
- `CHECK` and composite foreign keys: named with `CONSTRAINT <table>_<what>`.
- Partial indexes: the drift check cannot see `WHERE` clauses. Reviewers check them by hand.
- SQLite cannot alter most constraints in place. Changing one means the table-rebuild
  pattern (create new table, copy, drop, rename) with `PRAGMA foreign_keys=OFF` around it.
