# 048: First page load after signing in

Status: done

Task 039 found on 2026-09-25 that the first full page load after signing in fails with
"Select an organization first" (500). A new session has no active organization.
`getAppSession` picks one in the root route's `beforeLoad` and saves it with
`setActiveOrganization`. The route's loaders then call server functions in the same
request, and `scopeMiddleware` reads the session from the request's cookies. Better
Auth's cookie cache (`cookieCache`, 5 minutes) still holds the session without an active
organization, so `resolveScope` refuses. The retry works, because the browser has the new
cookie by then.

A provider sign-in returns with a full page load, so it hits this every time. Password and
passkey sign-in navigate in the browser, where `getAppSession` answers before the loaders
run, so they don't. A session whose organization the user has left meets it too.

Repro: sign in with `POST /api/auth/sign-in/email` as a seeded user and keep the cookies.
The first `GET /timer` answers 500, and the second 200.

## Acceptance criteria

- [x] The server functions in the request that set the organization read the new one:
      when the cached session gives no scope, `scopeMiddleware` reads the session again
      from the database, bypassing the cookie cache, and uses its organization once
      (`resolveSessionScope` in `src/server/scope.server.ts`). That covers a new session
      and one whose organization the user left; a session-create hook would have covered
      only the first
- [x] Tests cover the fallback against a seeded database (`scope.test.ts`): a session
      without an organization, one the user left, one that needs no second read, and a
      stored session with nothing better. The full flow was checked by hand, since no
      test runs Better Auth: after `POST /api/auth/sign-in/email`, the first `GET /timer`
      answers 200 (it was 500), and Chrome opens the timer at once for two seeded users
- [x] A provider sign-in lands on the timer with no error page: it takes the same path, a
      full page load with a new session. Not tried against a real provider locally
