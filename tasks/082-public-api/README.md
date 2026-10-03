# 082: Public API with personal API keys

Status: in-progress

A versioned HTTP API under `/api/v1`, signed in with personal API keys, so clients outside
the browser can use the timer: a Raycast extension first, then a likely tray app and
scripts. Issue #2 proposed it, and Kait chose API keys (Option A) and settled the open
questions on 2026-10-01. The decisions below come from that reply.

On 2026-10-02 Kait switched to device sign-in (Option B), and the keys were reverted
(`d4101d8`). On 2026-10-03 Kait and the user went back to keys, because device sign-in
needs OAuth device authorization with registered applications and client ids to maintain.
That is out of scope while task 081 moves the backend to Rust, and keys leave it one auth
flow fewer to port. The keys are restored, subtask 02 records the cancelled device sign-in,
and device sign-in can still come later beside the keys.

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

Five points needed more than the reply said. `docs/architecture/auth.md` ("API keys")
records how the settled ones are built.

1. **Settled: the login-domain policy.** `ALLOWED_LOGIN_DOMAINS` (`89da7eb`) is checked on
   sign-in and on every session, and a key skips both. The `/api/v1` helper (subtask 03)
   checks the key's user with `loginDomainAllowed` (`src/lib/login-domains.ts`) on each
   request.
2. **Settled: the lifetime is always explicit.** The server requires one of `30d`, `90d`,
   `1y`, and `none`, and the plugin's own default stays unset.
3. **Settled: the plugin's per-key limit stays,** at 60 requests whose gaps are all under 5
   seconds. Its default of 10 requests a day would stop a menu bar item in minutes.
4. **Open, before subtask 03: the writes per request.** In 1.7.6 the plugin verifies a key
   with a read and two writes (`last_request`, or the rate-limit count, and `updated_at`),
   all before the response, so each `/api/v1` request waits on three sequential Turso round
   trips. `deferUpdates: true` is set but defers only the deletion of expired keys. The
   options:
   1. Accept the cost.
   2. Verify keys with our own lookup of the plugin's hash, one read, and record last use at
      most once a minute after the response. This departs from Kait's "verify with the
      plugin", and the per-key limit would need its own count.
   3. Give the plugin secondary storage in Upstash, which Kait named as a later step.
5. **Settled: a missing scope answers 403.** `verifyApiKey` refuses a key without the
   asked-for permissions as 401 `KEY_NOT_FOUND`, like an unknown key. So the helper
   verifies without permissions, checks the key's `permissions` itself, and answers 403
   `FORBIDDEN`, so a client can tell a wrong key from a read-only one.

`AppError`'s `message` is the English text from `errorMessages`, and the error body uses it.
A `key` field for clients that translate can be added later without breaking the contract.

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
