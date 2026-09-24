# 005: Server foundation

Status: todo

Shared server-side building blocks every server function uses.

## Acceptance criteria

- [x] Server-only database client (`src/db/index.ts`); the Turso token never reaches the browser
- [ ] One tenancy helper: resolves session and active organization, checks membership
      and role, returns the scope (org id, user id, org role, led team ids)
- [x] Actor context (`src/db/actor.ts`) read by Drizzle `$defaultFn`/`$onUpdateFn` for
      `created_by`/`updated_by`; `SYSTEM_USER_ID` for scripts
- [ ] Middleware that wraps each server function in `withActor()` for the session user
- [ ] Shared query helpers that exclude `sys_deleted` rows
- [ ] Valibot installed; input schemas live where forms and server functions share them
- [ ] Unit tests for the tenancy helper's role rules (member / team lead / admin)
