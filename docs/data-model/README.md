# Data model

[`snowtime.dbml`](snowtime.dbml) is where the initial schema is designed and reviewed. Once
the first migration is written from it, the migrations become the source of truth (see
[`../migrations.md`](../migrations.md)) and the DBML turns into documentation: it will be
regenerated from the Drizzle schema so new developers can browse the model. Until that
generator exists, update the DBML by hand in the same change as a migration.
[`snowtime.chartdb.json`](snowtime.chartdb.json) is generated from the DBML; never edit it by
hand.

## Viewing the diagram

```
bun run datamodel        # regenerate the JSON and start ChartDB on http://localhost:8080
bun run datamodel:build  # regenerate the JSON only
bun run datamodel:stop   # stop ChartDB
```

In ChartDB, use **Actions > Import > .json** and pick `snowtime.chartdb.json`. ChartDB's own
DBML importer drops `TableGroup` blocks and colors, so the script emits ChartDB's native
format instead, with one colored area per group. Import always creates a new diagram;
delete the previous one after reimporting. Diagrams live in the browser's storage, not in
the container.

dbdiagram.io reads `snowtime.dbml` directly, groups and colors included.

The converter (`scripts/dbml-to-chartdb.mjs`) understands a subset of DBML: single-line
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
