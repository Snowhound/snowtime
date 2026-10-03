# 082: Public API with personal API keys

Status: in-progress

A versioned HTTP API under `/api/v1`, signed in with personal API keys, so clients outside
the browser can use the timer: a Raycast extension first, then a likely tray app and
scripts. Issue #2 proposed it; Kait chose personal API keys (Option A) and settled the open
questions on 2026-10-01. The decisions below come from that reply.

On 2026-10-02 Kait switched to device sign-in (Option B), so the keys were reverted
(`d4101d8`) and the task rewritten around it. On 2026-10-03 Kait and the user went back to
API keys: device sign-in needs Better Auth's OAuth device authorization with registered
applications and their client ids to maintain, which is out of scope while task 081 moves
the backend to Rust. The keys are restored (revert of `d4101d8`), and subtask 02 records the
cancelled device sign-in. Device sign-in can still come later beside the keys.

## Decisions

| Concern       | Decision                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in       | Personal API keys, `@better-auth/api-key` pinned to the `better-auth` version (1.7.6), as `@better-auth/passkey` is                          |
| Header        | `Authorization: Bearer <key>`; the `/api/v1` routes read it and call `verifyApiKey` themselves, so the header is our contract                |
| Key reach     | Only `/api/v1`. The plugin's sessions from API keys stay off, so a key can't call server functions or `/api/auth/*`                          |
| Cookie        | `/api/v1` ignores the session cookie, so it needs no CSRF check; no CORS headers for now                                                     |
| Prefix        | `snow_`, so people and secret scanners can spot a key                                                                                        |
| Per request   | After the key checks out: the user still exists, the login-domain policy still allows them, and `resolveScope` checks membership             |
| Expiry        | Chosen at creation: 30 days, 90 days (default), 1 year, or none                                                                              |
| Scopes        | `read` (me, timer, projects, entries) and `write` (start and stop), as plugin permissions                                                    |
| Organizations | A key belongs to a user. Scoped endpoints take the organization in the path; `GET /api/v1/me` lists the user's organizations                 |
| Rate limits   | The per-key limit plus the per-user write rate that `sessionMiddleware` counts                                                               |
| Contract      | `docs/api.md`; error body `{ "error": { "code", "message" } }`; fields are added, never changed in meaning; breaking changes go in `/api/v2` |
| Extension     | Its own repository; the key is a Raycast password preference; Raycast Store through `raycast/extensions` later                               |
| User deletion | Deletes the user's keys                                                                                                                      |

## Notes from checking the reply

Checking the reply against the repository and the plugin's 1.7.6 source
(`dist/index.mjs`) turned up five points where they differ. They are settled or
deferred as follows.

1. **Settled: the login-domain policy.** `main` added it in `89da7eb`:
   `ALLOWED_LOGIN_DOMAINS`, checked by `src/server/auth/login-policy.server.ts` on sign-in
   and on every session. A key skips both, so the `/api/v1` helper (subtask 03) checks the
   key's user with `loginDomainAllowed` (`src/lib/login-domains.ts`) on each request.
2. **Settled: the lifetime is always explicit.** The server takes a required lifetime from
   an enum (`30d`, `90d`, `1y`, `none`), so "no expiry" is a choice, never a missing value.
   The form preselects `90d`. The plugin's own default stays unset
   (`keyExpiration.defaultExpiresIn` is `null`), because the plugin applies a default
   whenever `expiresIn` is empty, which would make `none` impossible. The plugin's
   `maxExpiresIn` default of 365 days allows `1y`.
3. **Settled in subtask 01: the plugin's per-key limit stays, at 60 requests a 5-second
   window** (`rateLimits.apiKeyRequests`). Its default of 10 requests a day would stop a
   menu bar item in minutes. The plugin restarts the window once a request comes more than
   the window after the previous one, so the limit caps bursts, not a steady rate: a client
   polling every 5 seconds or slower never reaches it. Keeping it costs no extra write,
   because the plugin writes the key's row on every verification anyway (point 4).
4. **Open again: the writes per request.** `deferUpdates: true` is set, as decided on
   2026-10-01, but it doesn't do what this note first said. In 1.7.6, verifying a key with
   database storage awaits a read and two writes: `lastRequest` (or the rate-limit count)
   and `updatedAt`. `deferUpdates` moves only the deletion of expired keys after the
   response; it defers the usage writes only with secondary storage. So each `/api/v1`
   request costs three sequential Turso round trips before the route's own work. Settle
   before subtask 03 with the user, who checks with Kait. Options: accept the cost;
   verify keys with our own lookup (the plugin's hash, one read) and record last use at
   most once a minute after the response, which departs from Kait's "verify with the
   plugin"; or give the plugin secondary storage (Upstash), which Kait named as a later
   step.
5. **Settled: a missing scope answers 403.** When `verifyApiKey` checks permissions, a key
   without the scope fails as 401 `KEY_NOT_FOUND`, like an unknown key. The helper
   verifies without permissions, then checks the key's `permissions` itself and answers
   403 `FORBIDDEN`, the status Kait's reply accepted for `FORBIDDEN`, so a client can tell
   a wrong key from a read-only one.

Two smaller notes, no decision needed:

- `AppError` carries a `key`, and its `message` is the English text from `errorMessages`.
  The error body uses that English message. A `key` field for clients that translate can
  be added later without breaking the contract.
- The plugin's `referenceId` is a plain column, not a foreign key to `user`. The
  hand-written migration adds `REFERENCES user(id) ON DELETE CASCADE`, so deleting a user
  deletes their keys. The app has no user deletion yet.

## Subtasks

- [01: API keys](01-api-keys.md): the plugin, its table, and the Settings section
- [02: Device sign-in](02-device-sign-in.md): cancelled
- [03: API foundation](03-api-foundation.md): the shared helper, error mapping, and
  `docs/api.md`
- [04: Endpoints](04-endpoints.md): the six `/api/v1` endpoints
- [05: Raycast extension](05-raycast-extension.md): the client, in its own repository

## Acceptance criteria

- [x] `docs/product.md` moves the API and the Raycast extension out of "Not in MVP"
- [ ] Subtasks 01 and 03–05 are done
