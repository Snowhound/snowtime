# 03: API foundation

Status: todo

The helper every `/api/v1` route goes through, and the documented contract. With one
helper, a new route gets every check without writing any of them.

## Acceptance criteria

- [ ] A helper in `src/server/api/` (for example `api.server.ts`) wraps a route handler and,
      in order:
  1. reads `Authorization: Bearer <token>`, and answers 401 without one;
  2. looks the token up in `session`, with its user, and answers 401 if there is none, it
     has expired, or it isn't a device session (`session.client_id` is set), so a browser
     session's token doesn't work here (README point 1);
  3. checks that the session has the route's scope (`read` or `write`), and answers 403
     `FORBIDDEN` without it (README point 2);
  4. recheck first whether a login-domain policy exists by then, and apply it here if it
     does (README point 5);
  5. renews the session as Better Auth would (`expiresIn` and `updateAge` in
     `better-auth.server.ts`), at most once a day, so a client in use stays signed in;
  6. for a write, counts against `write:${userId}` in `rateLimitStore`, the same count as
     `sessionMiddleware`;
  7. for a route under `/api/v1/orgs/:orgId/`, resolves the scope with `resolveScope`;
  8. runs the handler inside `withActor(userId, ...)`
- [ ] The token lookup is one read: `session` joined to `user`, on the token's index
- [ ] Inputs are checked with the domains' Valibot schemas (`*.schemas.ts`); a failure
      answers 422 with the first issue's message
- [ ] `AppError` maps to a status: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404,
      `CONFLICT` 409, `LIMIT_REACHED` 422, `RATE_LIMITED` 429. Any other error answers 500
      with no details. The body is `{ "error": { "code": "...", "message": "..." } }`
- [ ] `/api/v1` sets no cookies, ignores the session cookie, and sends no CORS headers
- [ ] A test confirms that a device token doesn't sign in to a server function or to
      `/api/auth/*`, and that a browser session, by cookie or by its token, doesn't sign
      in to `/api/v1`
- [ ] Tests against seeded databases (`src/server/testing.ts`): no token, an unknown token,
      an expired session, a signed-out app, a read-only token on a write, another
      organization's path, renewal, and the write rate shared with the web app
- [ ] `docs/api.md` documents the contract: base URL, signing in with the device grant,
      the header, scopes, the error body and its codes, rate limits, and the versioning
      rule (fields are added, never changed in meaning; breaking changes go in `/api/v2`)
- [ ] `docs/architecture/README.md` describes the `/api/v1` routes beside the server
      functions: both are thin wrappers around `*.server.ts`, and why the API doesn't reuse
      Start's RPC (IDs from the build, Start's wire format, cookie sign-in)
- [ ] `AGENTS.md` lists `docs/api.md` under "Project context"
