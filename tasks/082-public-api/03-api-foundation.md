# 03: API foundation

Status: todo

The helper every `/api/v1` route goes through, and the documented contract. With one
helper, a new route gets every check without writing any of them.

## Acceptance criteria

- [ ] A helper in `src/server/api/` (for example `api.server.ts`) wraps a route handler and,
      in order:
  1. reads `Authorization: Bearer <key>`, and answers 401 without one;
  2. verifies the key with `auth.api.verifyApiKey`, without passing permissions;
  3. checks that the key has the route's scope (`read` or `write`), and answers 403
     `FORBIDDEN` without it (README, point 5);
  4. loads the user, and answers 401 if they no longer exist, or if `loginDomainAllowed`
     refuses their address under `ALLOWED_LOGIN_DOMAINS` (README, point 1);
  5. for a write, counts against `write:${userId}` in `rateLimitStore`, the same count as
     `sessionMiddleware`, plus the key's own limit as subtask 01 sets it (README, point 3);
  6. for a route under `/api/v1/orgs/:orgId/`, resolves the scope with `resolveScope`;
  7. runs the handler inside `withActor(userId, ...)`
- [ ] Inputs are checked with the domains' Valibot schemas (`*.schemas.ts`); a failure
      answers 422 with the first issue's message
- [ ] `AppError` maps to a status: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404,
      `CONFLICT` 409, `LIMIT_REACHED` 422, `RATE_LIMITED` 429. Any other error answers 500
      with no details. The body is `{ "error": { "code": "...", "message": "..." } }`
- [ ] `/api/v1` sets no cookies, ignores the session cookie, and sends no CORS headers
- [ ] A test confirms that a key doesn't sign in to a server function or to
      `/api/auth/*`, and that a session cookie doesn't sign in to `/api/v1`
- [ ] Tests against seeded databases (`src/server/testing.ts`): no key, an unknown key, an
      expired key, a revoked key, a read-only key on a write, another organization's path,
      and the write rate shared with the web app
- [ ] `docs/api.md` documents the contract: base URL, the header, scopes, the error body and
      its codes, rate limits, and the versioning rule (fields are added, never changed in
      meaning; breaking changes go in `/api/v2`)
- [ ] `docs/architecture/README.md` describes the `/api/v1` routes beside the server
      functions: both are thin wrappers around `*.server.ts`, and why the API doesn't reuse
      Start's RPC (IDs from the build, Start's wire format, cookie sign-in)
- [ ] `AGENTS.md` lists `docs/api.md` under "Project context"
