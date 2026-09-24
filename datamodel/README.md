# Data model

The database diagram. [`snowtime.dbml`](snowtime.dbml) is the source;
[`snowtime.chartdb.json`](snowtime.chartdb.json) is generated from it for
[ChartDB](https://chartdb.io), which runs locally in Docker. Never edit the JSON by hand.

## Viewing the model

1. `bun run datamodel`. This regenerates the JSON and starts ChartDB on
   http://localhost:8080.
2. In ChartDB, open **Actions > Import > .json** and pick `datamodel/snowtime.chartdb.json`.
   Do not import the `.dbml` file: ChartDB's DBML importer drops the table groups and
   colors, and the result is an unsorted pile of tables.
3. When you are done, `bun run datamodel:stop`.

Diagrams live in your browser's storage, not in the container. Every import creates a new
diagram, so delete the old one after reimporting.

## Changing the model

**Now (initial design):** the DBML is where the schema is designed.

1. Edit `snowtime.dbml`.
2. `bun run datamodel:build` (or `bun run datamodel` if ChartDB is not running).
3. Reimport the JSON in ChartDB (step 2 above) and review.
4. Commit the DBML and the regenerated JSON together.

**After the first migration:** the SQL migrations are the source of truth (see
[`docs/migrations.md`](../docs/migrations.md)), and this folder is documentation for
browsing the model. The DBML will be regenerated from the Drizzle schema; until that
generator exists, update the DBML by hand in the same change as each migration, then
rebuild the JSON as above.

dbdiagram.io reads `snowtime.dbml` directly, groups and colors included.

The converter (`datamodel/dbml-to-chartdb.mjs`) understands a subset of DBML: single-line
columns, inline `ref: >` references, `indexes` blocks, `TableGroup`, and single-quoted notes
without apostrophes. Standalone `Ref:` lines are ignored.

## Conventions

- Physical names: `snake_case`, singular table names.
- Types are SQLite storage types. `integer` columns named `*_at` are UTC epoch
  milliseconds; boolean columns are `integer` 0/1. Drizzle maps both.
- Primary keys are UUIDv7 `text`. App-owned rows get their id on the client, so
  optimistic updates keep a stable key.
- Closed vocabularies are `text` with a `CHECK`, listed in the column note.
- Tables in the `auth` and `tenancy` groups belong to Better Auth. Follow the plugin's
  shape; the only app addition is `team_member.role`.
- Every app-owned table carries a non-null `organization_id`, except `user_settings`,
  which belongs to the user across organizations.
- References that must stay inside one organization are composite foreign keys on
  `(id, organization_id)`; the target tables carry a matching unique index. The diagram
  draws only the single-column reference, and the note on the column names the composite.
- Partial indexes and `CHECK` constraints are described in notes, since DBML cannot
  express them; the migrations implement them.

## Decisions

- Team reports count entries by the team's current members; `time_entry` has no
  `team_id`.
