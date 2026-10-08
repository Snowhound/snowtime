# 081.32: Login domains and the auth error page

Status: done

Fix M1 and L1 from [081.30](30-audit.md) on branch `081-domains`, from `081-audit` at
`d67ba4c`. The TypeScript server (`src/server/auth/login-policy.server.ts`,
`better-auth.server.ts`) and Better Auth 1.7.7 (`api/routes/error.mjs`) are the behavior
reference; `src/` is unchanged.

## Acceptance criteria

- [x] `find_session_using` returns the user's email with the session.
      `find_session_with_writer`, the API's session check, treats a session whose domain
      `ALLOWED_LOGIN_DOMAINS` doesn't list as none, as the app's `get-session` hook does: the
      `/api/v1` routes answer 401 and `GET /api/v1/session` answers `null`.
- [x] Sign-out still deletes such a session.
- [x] Password sign-in refuses an address outside the list after the password check, as
      the session-creation hook does for passkeys and OAuth, and writes no session.
- [x] One shared check, `auth/login_domains.rs`, replaces the copies in `passkeys.rs`,
      `oauth.rs`, `acceptance.rs`, `writes.rs`, and `invitations.rs`, and follows
      `loginDomainAllowed`: trimmed, lower case, one `@`, a local part, an exact domain.
- [x] `/api/auth/error` serves Better Auth's error page: the same status, content type,
      and HTML for `error` and `error_description`, escaped as `sanitize` does. With
      `NODE_ENV=production` it redirects to `/?error=…` as Better Auth does.
- [x] Conformance covers an existing session after the list narrows and password sign-in;
      `compare.ts` covers both and the error page.
- [x] The requested verification passes, and the audit probes show the fixes.

## Parity record

Better Auth runs the app's `loginDomainMiddleware` as a before hook on every route except
`/sign-out` and `/get-session`. With a list set, a request whose session cookie belongs to
an unlisted domain gets 403 before the route's own body checks. Native runs that check in
one function, `App::login_domain_middleware`, after the origin and callback URL checks and
before the body schema on every ported Better Auth route that takes a session: email
sign-in, passkeys, OAuth (including list, unlink, and the callback), the profile and
organization writes, invitation acceptance, and the error page. The checks that each
route repeated after reading the session are removed.

TypeScript answers every one of these refusals with
`{"code":"LOGIN_DOMAIN_NOT_ALLOWED","message":"This email domain cannot sign in to this instance."}`,
code first, including the session-creation refusal in email sign-in. Native's passkey,
OAuth, and acceptance routes answered with the message first; no comparison covered them.
They now share `login_domains::refusal()`. The OAuth callback's refusal for a new session
stays a redirect to the error URL.

Deliberate differences from TypeScript:

| Case                                        | Native                                                                                                                                           | TypeScript                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Error page headers                          | The edge's security headers, `cache-control: private, no-store`, and compression. Status, `content-type: text/html`, `location`, and body match. | The app's CSP with a nonce, no cache header                                           |
| Refusal content type                        | `application/json; charset=UTF-8`, as on every native JSON answer                                                                                | `application/json`                                                                    |
| Session cookie cache                        | Not ported: every check reads the session row (unchanged)                                                                                        | `session_data` serves the session for 5 minutes; the hooks still apply the list to it |
| Better Auth routes that native doesn't port | 404 from native's router, without the middleware                                                                                                 | The middleware's 403 first                                                            |
| API invite and acceptance (`/api/v1`)       | Keep their API-format domain refusals, now unreachable: the API's session check refuses the session first                                        | The same: `getSession` returns `null` first                                           |

The passkey sign-in refusal for a new session (`passkeys.rs`, `new_session`) is now code
first too. No comparison covers it; the passkey plugin rethrows the session hook's
`APIError` as email sign-in does, which the comparison does cover.

A blocked session is renewed when due, as before and as TypeScript's `getSession` does
before its hook answers `null`.

## Verification

2026-10-08, macOS arm64, on the uncommitted fix over `d67ba4c`. Logs:
`/private/tmp/claude-501/-Users-kaitkasak-projects-snowtime-snowtime/96e2565a-6dc3-4223-b493-9999fea41aa1/scratchpad/v1`.

| Check                                                                  | Result                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `bun install && bun run i18n:compile`                                  | Passed                                                    |
| `bun run build && bun native/crates/render/bundle/build.ts`            | Passed                                                    |
| `cargo fmt --check`                                                    | Passed                                                    |
| Workspace Clippy, all targets, `-D warnings`, with and without `bench` | Passed                                                    |
| `snowtime-server` tests, without and with `bench`                      | 113 passed in each (baseline 108)                         |
| `snowtime-host` tests                                                  | 17 passed                                                 |
| `snowtime-host` build with `bench`                                     | Passed                                                    |
| Conformance, one fixture per file                                      | 54 tests, 539 assertions, 11 files (baseline 49, 528, 10) |
| `compare.ts`                                                           | 1,409 calls, all byte-equal (baseline 1,381)              |
| `hardening-compare.ts`                                                 | 17 targeted checks passed                                 |
| `bunx tsc --noEmit`                                                    | Passed                                                    |

The five new server tests cover the shared check, Better Auth's `sanitize`, the page's
placeholders, the API's session check with a narrowed list, and password sign-in with a
blocked address, a wrong password, a blocked session cookie, and an allowed address.

The new `conformance/login-domains.conformance.ts` (5 tests, 11 assertions) runs on
`login-domains-fixture.ts`: the seeded owner (`lumen.example.com`) keeps a session while
the list names only `example.com`. `native/bench/conformance.ts` starts the native server
on that fixture for this file. It passes on TypeScript and on the fixed native host; on the
`d67ba4c` host, 3 of its 5 tests fail.

The 28 new `compare.ts` calls (`native/bench/login-domains-compare.ts`) are 16 on the
narrowed fixture (API reads and a write, four email sign-ins, the error page and eight
Better Auth routes with the old session, sign-out, and a call after it) and 6 error-page
queries each in development and in production: none, a known code, a code with `'`, a
description to escape, an invalid code with an empty description, and repeated codes with
an invalid percent escape.

`tsc` first failed until the packages in `native/bench/auth-spike` and
`native/crates/render/bundle/bench` were installed with their frozen lockfiles, as in
081.31 and 081.33. The host test, conformance, comparison, and probe runs ran outside the
sandbox, which can't bind their ports. `cargo check -p snowtime-server --features
auth-spike` also passes. No Docker, load, or stress runs.

### Audit probes

`bun native/bench/audit/probe.ts native/target/debug/snowtime-axum domains errorpage`

| Probe                                       | `d67ba4c`                                   | After                          |
| ------------------------------------------- | ------------------------------------------- | ------------------------------ |
| Existing session, `GET /api/v1/timer`       | 200                                         | 401                            |
| Existing session, `GET /api/v1/session`     | 200 with the user                           | 200 `null`                     |
| Existing session, `POST` project            | 400                                         | 401                            |
| Password sign-in, blocked domain            | 200 with a session                          | 403 `LOGIN_DOMAIN_NOT_ALLOWED` |
| `GET /api/auth/error?error=state_not_found` | 404 `{"error":{"message":"No such call."}}` | 200 Better Auth's page         |
