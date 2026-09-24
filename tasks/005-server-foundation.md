# 005: Server foundation

Status: todo

Shared server-side building blocks every server function uses.

## Acceptance criteria

- [ ] Server-only database client (`src/db/`); the Turso token never reaches the browser
- [ ] One tenancy helper: resolves session and active organization, checks membership
      and role, returns the scope (org id, user id, org role, led team ids)
- [ ] Per-request actor context read by Drizzle `$defaultFn`/`$onUpdateFn` for
      `created_by`/`updated_by`; a fixed system user for scripts
- [ ] Shared query helpers that exclude `sys_deleted` rows
- [ ] Valibot installed; input schemas live where forms and server functions share them
- [ ] Unit tests for the tenancy helper's role rules (member / team lead / admin)
