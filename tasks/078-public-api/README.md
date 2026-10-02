# 078: Public API with device sign-in

Status: todo

A versioned HTTP API under `/api/v1` for clients outside the browser: a Raycast extension
first, then a likely tray app and scripts. A client signs in with the OAuth 2.0 device
authorization grant (RFC 8628): it shows a code, the user approves it in Snowtime, and the
client gets a token. Issue #2 proposed this as Option B.

On 2026-10-01 Kait's reply on issue #2 chose personal API keys (Option A), and subtask 01
built them. On 2026-10-02 Kait told the user he had meant device sign-in, so subtask 01 is
cancelled and its code reverted (`f8f3848`).

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
  `expires_in` the session's expiry. Sessions last 7 days and renew while they're used.
- The plugin stores the `scope` and `client_id` a client asked for on the device code, not
  on the session, and enforces neither. `validateClient` can refuse unknown client ids.
- The `bearer` plugin turns an `Authorization: Bearer` header into the session on every
  Better Auth call. With it on, a device token would also reach server functions and
  `/api/auth/*`: change the profile, link accounts, create organizations.

## To settle with Kait before subtask 02

Asked on issue #2 on 2026-10-02
(https://github.com/Snowhound/snowtime/issues/2#issuecomment-5949060428). Each item has a
proposal.

1. **Where a token reaches.** Proposed: only `/api/v1`. Leave the `bearer` plugin off,
   and have the `/api/v1` helper look the token up in `session` itself. Without the plugin,
   a raw token can't stand in for the signed session cookie, so it can't call server
   functions or `/api/auth/*`. This keeps the spirit of Kait's "keys only on `/api/v1`":
   a leaked token can't change the account or sign in elsewhere.
2. **Scopes.** Kait wanted `read` and `write` from the start, because adding scopes once
   clients are out is hard. Proposed: the client asks for `scope=read` or
   `scope=read write`, the approval page says which, and a hook after `/device/token`
   copies the scope onto the session (an added `session.scope` column). The helper checks
   it and answers 403 without the route's scope.
3. **Which clients.** Proposed: `validateClient` accepts only client ids listed in the
   server's config, each with a display name, so the approval page can say "Raycast wants
   to use Snowtime as you". A script or a new client gets an entry there. The client id is
   copied onto the session too (`session.client_id`), so Settings can list connected apps.
4. **Token lifetime.** Proposed: the usual 7-day session, renewed while used. A client
   unused for a week signs in again. A longer lifetime for device sessions would need its
   own expiry, since Better Auth's applies to every session.
5. **Recheck when implementing: the login-domain policy.** Nothing in `src/`, `docs/`, or
   `tasks/` restricts sign-in by email domain on 2026-10-02. Before subtask 03, find out
   whether the policy exists by then, and check it per request if it does.

## Subtasks

- [01: API keys](01-api-keys.md): cancelled
- [02: Device sign-in](02-device-sign-in.md): the plugin, the approval page, and connected
  apps in Settings
- [03: API foundation](03-api-foundation.md): the shared helper, error mapping, and
  `docs/api.md`
- [04: Endpoints](04-endpoints.md): the six `/api/v1` endpoints
- [05: Raycast extension](05-raycast-extension.md): the client, in its own repository

## Acceptance criteria

- [ ] Kait has confirmed or changed points 1–4 above, and this file records the answers
- [ ] `docs/product.md` moves the API and the Raycast extension out of "Not in MVP"
- [ ] Subtasks 02–05 are done
