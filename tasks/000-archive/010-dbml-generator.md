# 010: DBML generator

Status: done

After task 003, regenerate `datamodel/snowtime.dbml` from `src/db/schema.ts` so the
diagram stays current without hand edits (pattern: minupatsient
`scripts/generate-datamodel.ts`).

## Acceptance criteria

- [x] `bun run datamodel:generate` writes the DBML from the Drizzle schema
- [x] Table groups and colors from a small, explicit mapping; unmapped tables warned
- [x] Column notes preserved, in a side file (`datamodel/notes.ts`)
- [x] `datamodel/README.md` flow updated; hand-editing the DBML no longer needed
