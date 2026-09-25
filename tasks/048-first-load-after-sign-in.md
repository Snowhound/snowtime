# 048: First page load after signing in

Status: todo

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

- [ ] A new session starts with an active organization, for example from a Better Auth
      session-create hook, or the server functions in the request that set it read the
      new one
- [ ] A test signs in and loads a page that calls a scoped server function in the same
      request
- [ ] A provider sign-in lands on the timer with no error page
