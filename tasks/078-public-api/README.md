# 078: Public API with personal API keys

Status: todo

A versioned HTTP API under `/api/v1`, signed in with personal API keys, so clients outside
the browser can use the timer: a Raycast extension first, then a likely tray app and
scripts. Issue #2 proposed it; Kait chose personal API keys (Option A) and settled the open
questions on 2026-10-01. The decisions below come from that reply.

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

Device sign-in (Option B in the issue) can come later beside the keys; nothing here blocks
it.

## Notes from checking the reply

Checking the reply against the repository and the plugin's 1.7.6 source
(`dist/index.mjs`) turned up five points where they differ. They are settled or
deferred as follows; nothing is posted on issue #2.

1. **Recheck when implementing: the login-domain policy.** Nothing in `src/`, `docs/`, or
   `tasks/` restricts sign-in by email domain on 2026-10-01; the closest rule is
   `refuseUnverifiedSignUp`, which runs only at sign-up. Before subtask 02, find out
   whether the policy exists by then, and check it per request if it does. Until then the
   helper checks that the user still exists.
2. **Settled: the lifetime is always explicit.** The server takes a required lifetime from
   an enum (`30d`, `90d`, `1y`, `none`), so "no expiry" is a choice, never a missing value.
   The form preselects `90d`. The plugin's own default stays unset
   (`keyExpiration.defaultExpiresIn` is `null`), because the plugin applies a default
   whenever `expiresIn` is empty, which would make `none` impossible. The plugin's
   `maxExpiresIn` default of 365 days allows `1y`.
3. **Recheck when implementing: the plugin's per-key rate limit.** It is on by default at
   10 requests a day (`rateLimit.maxRequests: 10`, `timeWindow` 24 hours), which a menu bar
   item reloading the timer would hit in minutes. It also counts in the key's database
   row, a Turso write per request, which `docs/architecture/auth.md` rejected for Better
   Auth's own limits ("Abuse limits"). Kait asked to keep it, so subtask 01 sets a limit
   that fits a polling client, or turns it off and counts each key in `rateLimitStore`
   instead. Decide with numbers when implementing.
4. **Ask before implementing: the write per request.** A verified key costs a read and a
   write, not one lookup: even with its rate limit off, the plugin writes `lastRequest` on
   every verification. `deferUpdates: true` moves that write after the response
   (`runInBackground`). Ask the user before choosing; they will check with Kait.
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
- [02: API foundation](02-api-foundation.md): the shared helper, error mapping, and
  `docs/api.md`
- [03: Endpoints](03-endpoints.md): the six `/api/v1` endpoints
- [04: Raycast extension](04-raycast-extension.md): the client, in its own repository

## Acceptance criteria

- [ ] `docs/product.md` moves the API and the Raycast extension out of "Not in MVP"
- [ ] Subtasks 01–04 are done
