# 001: Data model

Status: in-progress

Design the MVP schema in DBML and review it in ChartDB before writing the Drizzle
schema. See `datamodel/README.md`.

## Acceptance criteria

- [x] `datamodel/snowtime.dbml` covers auth, tenancy, projects, entries and settings
- [x] `bun run datamodel` regenerates the ChartDB JSON and starts ChartDB locally
- [x] Open questions resolved (team reports, composite FKs)
- [ ] Model reviewed and signed off
- [ ] First migration written from the DBML
