# 006: Server functions

Status: in-progress

Named mutations and queries the UI calls. Each resolves scope through the tenancy
helper (task 005), validates input with Valibot and filters by `organization_id`.
One subtask per area.

## Acceptance criteria

- [x] `01-timer.md`
- [x] `02-entries.md`
- [ ] `03-projects.md`
- [ ] `04-settings.md`
