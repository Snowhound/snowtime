# 082: Public API with device sign-in

Status: todo

A versioned HTTP API under `/api/v1` for clients outside the browser: a Raycast extension
first, then a likely tray app and scripts. A client signs in with the OAuth 2.0 device
authorization grant (RFC 8628): it shows a code, the user approves it in Snowtime, and the
client gets a token. Issue #2 proposed this as Option B.

On 2026-10-01 Kait's reply on issue #2 chose personal API keys (Option A), and subtask 01
built them. On 2026-10-02 Kait chose device sign-in instead, so subtask 01 is cancelled
and its code reverted (`d4101d8`). Kait's reasons, from issue #2
(https://github.com/Snowhound/snowtime/issues/2#issuecomment-5949004983):

- Sessions last 30 days and renew daily while used (`825d977`), so a client that runs all
  the time effectively never signs out.
- Signing in goes through the normal flow, so the login-domain policy, passkeys, and OAuth
  apply as in the browser.
- No secret to copy into each app; every client, including the planned tray app, gets the
  same "Sign in with Snowtime" flow.

Task 081 (native backend) lists device authorization in better-auth-rs's v1 scope, and API
keys as a possible later addition for scripts.

## What carries over from the reply

Kait's answers that don't depend on how a client signs in still hold:

| Concern       | Decision                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Header        | `Authorization: Bearer <token>`; the `/api/v1` routes read it themselves, so the header is our contract                                      |
| Cookie        | `/api/v1` ignores the session cookie, so it needs no CSRF check; no CORS headers for now                                                     |
| Per request   | After the token checks out: the user still exists, the login-domain policy still allows them, and `resolveScope` checks membership           |
| Organizations | A token belongs to a user. Scoped endpoints take the organization in the path; `GET /api/v1/me` lists the user's organizations               |
| Rate limits   | The per-user write rate that `sessionMiddleware` counts applies to `/api/v1` too                                                             |
| Contract      | `docs/api.md`; error body `{ "error": { "code", "message" } }`; fields are added, never changed in meaning; breaking changes go in `/api/v2` |
| Extension     | Its own repository; Raycast Store through `raycast/extensions` later                                                                         |
| User deletion | Deletes the user's tokens                                                                                                                    |

The key-only answers (the `snow_` prefix, the 30-day to no-expiry lifetimes, the plugin's
per-key rate limit) no longer apply.

## How Better Auth 1.7.6 does device sign-in

Read from `better-auth/dist/plugins/device-authorization/` and `bearer/` on 2026-10-02:

- `deviceAuthorization()` adds a `deviceCode` table and five endpoints under `/api/auth`:
  `/device/code` (the client asks for a code), `/device/token` (the client polls),
  `/device` (look up a user code), and `/device/approve` and `/device/deny` (the signed-in
  user answers). Codes last 30 minutes by default, and the client polls every 5 seconds.
- An approved code becomes an ordinary Better Auth session: `/device/token` calls
  `createSession(userId)` and returns the session's token as `access_token`, with
  `expires_in` the session's expiry. Sessions last 30 days and renew daily while used.
- The plugin stores the `scope` and `client_id` a client asked for on the device code, not
  on the session, and enforces neither. `validateClient` can refuse unknown client ids.
- The `bearer` plugin turns an `Authorization: Bearer` header into the session on every
  Better Auth call. With it on, a device token would also reach server functions and
  `/api/auth/*`: change the profile, link accounts, create organizations.
- The login-domain policy (`ALLOWED_LOGIN_DOMAINS`, `src/server/auth/login-policy.server.ts`)
  checks a new session in a database hook, so it applies when `/device/token` creates one.
  It checks existing sessions in an after hook on `/get-session`
  (`loginDomainSessionAllowed`), which a lookup outside Better Auth doesn't pass through.

## To settle with Kait before subtask 02

Asked on issue #2 on 2026-10-02
(https://github.com/Snowhound/snowtime/issues/2#issuecomment-5949060428). Kait's comment
before it answered none of points 1–3; the user asks again with a correction. Each item has
a proposal.

1. **Where a token reaches.** Proposed: only `/api/v1`. Leave the `bearer` plugin off,
   and have the `/api/v1` helper look the token up in `session` itself. Without the plugin,
   a raw token can't stand in for the signed session cookie, so it can't call server
   functions or `/api/auth/*`: a leaked token can't change the account. The cost: the
   helper calls `loginDomainSessionAllowed` itself, a check of the user's email against the
   list, since the lookup skips `/get-session`. With `bearer` on, Better Auth's session
   check and the policy run with no extra code, but the token reaches the whole app.
2. **Scopes.** Kait wanted `read` and `write` from the start, because adding scopes once
   clients are out is hard. Proposed: the client asks for `scope=read` or
   `scope=read write`, the approval page says which, and a hook after `/device/token`
   copies the scope onto the session (an added `session.scope` column). The helper checks
   it and answers 403 without the route's scope.
3. **Which clients.** Proposed: `validateClient` accepts only client ids listed in the
   server's config, each with a display name, so the approval page can say "Raycast wants
   to use Snowtime as you". A script or a new client gets an entry there. The client id is
   copied onto the session too (`session.client_id`), so Settings can list connected apps.

Settled:

- **Token lifetime:** the app's 30-day session, renewed daily while used (`825d977`). The
  first reply on issue #2 said 7 days; the branch was behind `main`.
- **The login-domain policy exists** (`89da7eb`): `ALLOWED_LOGIN_DOMAINS`. A device session
  is checked when it's created, and the `/api/v1` helper checks it on each request
  (point 1). The first reply said it couldn't be found, for the same reason.

## Subtasks

- [01: API keys](01-api-keys.md): cancelled
- [02: Device sign-in](02-device-sign-in.md): the plugin, the approval page, and connected
  apps in Settings
- [03: API foundation](03-api-foundation.md): the shared helper, error mapping, and
  `docs/api.md`
- [04: Endpoints](04-endpoints.md): the six `/api/v1` endpoints
- [05: Raycast extension](05-raycast-extension.md): the client, in its own repository

## Acceptance criteria

- [ ] Kait has confirmed or changed points 1–3 above, and this file records the answers
- [ ] `docs/product.md` moves the API and the Raycast extension out of "Not in MVP"
- [ ] Subtasks 02–05 are done
