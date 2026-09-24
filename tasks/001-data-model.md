# 001: Data model

Status: done

Design the MVP schema in DBML and review it in ChartDB before writing the Drizzle
schema. See `datamodel/README.md`.

## Acceptance criteria

- [x] `datamodel/snowtime.dbml` covers auth, tenancy, projects, entries and settings
- [x] `bun run datamodel` regenerates the ChartDB JSON and starts ChartDB locally
- [x] Open questions resolved (team reports, composite FKs)
- [x] Audit columns and logical delete decided and applied to the DBML
- [x] Model reviewed and signed off
- [x] First migration written from the DBML (task 003)
