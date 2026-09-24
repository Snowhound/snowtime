# 005: Server foundation

Status: done

Shared server-side building blocks every server function uses.

## Acceptance criteria

- [x] Server-only database client (`src/db/index.ts`); the Turso token never reaches the browser
- [x] One tenancy helper (`resolveScope` in `src/server/scope.server.ts`): resolves the
      active organization, checks membership and role, returns the scope (org id, user id,
      org role, led team ids)
- [x] Actor context (`src/db/actor.ts`) read by Drizzle `$defaultFn`/`$onUpdateFn` for
      `created_by`/`updated_by`; `SYSTEM_USER_ID` for scripts
- [x] Middleware (`src/server/middleware.ts`) that wraps each server function in
      `withActor()` for the session user: `sessionMiddleware` for calls not tied to an
      organization, `scopeMiddleware` for tenant data
- [x] Shared query helpers that exclude `sys_deleted` rows (`src/server/queries.server.ts`)
- [x] Valibot installed; input schemas live in `src/schemas/`, which forms and server
      functions share
- [x] Unit tests for the tenancy helper's role rules (member / team lead / admin)
