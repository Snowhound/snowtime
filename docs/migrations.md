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
6. `bun run datamodel:generate` to regenerate the diagram. Add a new table to a group in
   `datamodel/notes.ts`, with its notes; the generator warns about tables in no group.

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
  `schema.ts` ``.default(sql`0`)`` rather than `.default(false)`, or drift reports a
  false difference.
- Unique constraints: a named `CREATE UNIQUE INDEX`, never inline `UNIQUE (...)`, which
  introspection cannot see.
- `CHECK` and composite foreign keys: named with `CONSTRAINT <table>_<what>`.
- Partial indexes: the drift check cannot see `WHERE` clauses. Reviewers check them by hand.
  On soft-deleted tables, unique indexes include `sys_deleted = 0`.
- Queries compare `sys_deleted` with a literal `0` (`notDeleted` in
  `src/server/queries.server.ts`), not a bound parameter. SQLite uses a partial index only
  when it can prove the query matches its `WHERE`, so `sys_deleted = ?` scans the table.

### Audit columns

Every app-owned table ends with the audit columns (`docs/architecture.md`, "Data
conventions" has the reasons):

```sql
CREATE TABLE my_table (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organization(id),
  -- ... domain columns ...
  created_at integer NOT NULL DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)),
  created_by text NOT NULL REFERENCES user(id),
  updated_at integer NOT NULL DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)),
  updated_by text NOT NULL REFERENCES user(id),
  sys_deleted integer NOT NULL DEFAULT 0 CONSTRAINT my_table_sys_deleted CHECK (sys_deleted IN (0, 1))
);
--> statement-breakpoint
CREATE TRIGGER my_table_updated_at AFTER UPDATE ON my_table FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE my_table SET updated_at = CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)
  WHERE id = NEW.id;
END;
```

- Keep the `ROUND` and `CAST`: without them the value can be stored as a float.
- Drop `updated_*` and the trigger for insert-and-delete link tables; drop `sys_deleted`
  for tables that are not soft-deleted.
- In `schema.ts`, `updated_at` gets `$onUpdate` so the trigger stays a fallback, and
  `created_by`/`updated_by` get `$defaultFn`/`$onUpdateFn` from the request's actor.
- Triggers are invisible to the drift check. A table rebuild drops them; recreate them
  in the same migration.
- SQLite cannot alter most constraints in place. Changing one means the table-rebuild
  pattern (create new table, copy, drop, rename) with `PRAGMA foreign_keys=OFF` around it.
