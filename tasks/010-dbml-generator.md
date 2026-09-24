# 010: DBML generator

Status: todo

After task 003, regenerate `datamodel/snowtime.dbml` from `src/db/schema.ts` so the
diagram stays current without hand edits (pattern: minupatsient
`scripts/generate-datamodel.ts`).

## Acceptance criteria

- [ ] `bun run datamodel:generate` writes the DBML from the Drizzle schema
- [ ] Table groups and colors from a small, explicit mapping; unmapped tables warned
- [ ] Column notes preserved (source to decide: schema comments or a side file)
- [ ] `datamodel/README.md` flow updated; hand-editing the DBML no longer needed
