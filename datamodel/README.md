# Data model

The database diagram, generated from the Drizzle schema. Never edit either file by hand:

- [`snowtime.dbml`](snowtime.dbml) comes from `src/db/schema.ts` and
  [`notes.ts`](notes.ts), written by [`generate-dbml.ts`](generate-dbml.ts).
- [`snowtime.chartdb.json`](snowtime.chartdb.json) comes from the DBML, for
  [ChartDB](https://chartdb.io), which runs locally in Docker.

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

The SQL migrations are the source of truth ([`docs/migrations.md`](../docs/migrations.md)),
and `db:drift` keeps `schema.ts` in line with them. This folder only documents the model.

1. Change the schema through a migration and `schema.ts`.
2. For a new table, add it to a group in `notes.ts`. Add notes for the table and for any
   column whose name and type do not say enough.
3. `bun run datamodel:generate`. It writes the DBML, then the ChartDB JSON.
4. Commit both files with the migration. `bun run datamodel:check` fails if the DBML is
   out of date.

The generator takes columns, types, defaults, keys, indexes and references from
`schema.ts`. It also writes these notes itself, so `notes.ts` leaves them out:

- ON DELETE rules
- The `WHERE` clause of a partial index
- The composite foreign key a column is part of. The diagram draws only the single-column
  reference; for `(project_id, organization_id)` that is `project_id`.

It warns about tables in no group, tables without a note, and notes for columns or
indexes that no longer exist. `CHECK` constraints stay in column notes.

dbdiagram.io reads `snowtime.dbml` directly, groups and colors included.

The converter (`datamodel/dbml-to-chartdb.mjs`) understands a subset of DBML: single-line
columns, inline `ref: >` references, `indexes` blocks, `TableGroup`, and single-quoted notes
without apostrophes. The generator writes only that subset and rejects notes with an
apostrophe.

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
- Audit columns come last in every app-owned table, in this order: `created_at`,
  `created_by`, `updated_at`, `updated_by`, `sys_deleted`. Link tables that are only
  inserted and deleted have `created_*` only; `sys_deleted` is on entities users delete.
  Rules and reasons: `docs/architecture.md`, "Data conventions".
- DBML cannot express partial indexes or `CHECK` constraints, so notes describe them;
  the migrations implement them.

## Decisions

- Team reports count entries by the team's current members; `time_entry` has no
  `team_id`.
