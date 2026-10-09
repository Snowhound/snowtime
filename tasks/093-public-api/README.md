# 093: Public API with personal API keys

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

On 2026-10-04, merging main brought task 084's JSON API, which serves the app itself under
`/api/v1`, with a session cookie. The user chose to sign keys in to that API rather than
keep separate key-only routes beside it. The six endpoints of subtask 04 became the
operations marked `apiKeys: true` in `src/lib/api/operations.ts`, with a new `getMe`, and
the checks of subtask 03 moved into `keyUser` (`src/server/auth/api-keys.server.ts`), which
`src/server/api.server.ts` runs for a request with a key. The paths and answers are now
task 084's, so the Raycast extension moves to them.

On 2026-10-09 the branch was replayed onto main as task 093, because main's task 089 had
replaced the call table with Hono routes per domain and taken the number. Routes a key may
call are marked `keys`, `known` refuses a key on any other route, and `signedIn` checks the
key in place of the session (`src/server/http.server.ts`). Kait settled point 4 below the
same day. The paths the Raycast extension calls didn't change.

## Decisions

| Concern       | Decision                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in       | Personal API keys, `@better-auth/api-key` pinned to the `better-auth` version (1.7.6), as `@better-auth/passkey` is              |
| Header        | `Authorization: Bearer <key>`; the JSON API reads it and checks the key itself, so the header is our contract                    |
| Key reach     | Only the `/api/v1` routes marked `keys`. The plugin's sessions from API keys stay off, so a key can't call `/api/auth/*`         |
| Cookie        | A request with a key ignores the session cookie, so its writes skip the `Origin` check; no CORS headers for now                  |
| Prefix        | `snow_`, so people and secret scanners can spot a key                                                                            |
| Per request   | After the key checks out: the user still exists, the login-domain policy still allows them, and `resolveScope` checks membership |
| Expiry        | Chosen at creation: 30 days, 90 days (default), 1 year, or none                                                                  |
| Scopes        | `read` (me, timer, projects, entries) and `write` (start and stop), as plugin permissions                                        |
| Organizations | A key belongs to a user. Scoped calls take the organization in the path; `GET /api/v1/me` lists the user's organizations         |
| Rate limits   | The per-key limit plus the per-user write rate the session's calls count                                                         |
| Contract      | `docs/api.md`; task 084's error body; fields are added, never changed in meaning; breaking changes go in `/api/v2`               |
| Extension     | Its own repository; the key is a Raycast password preference; Raycast Store through `raycast/extensions` later                   |
| User deletion | Deletes the user's keys                                                                                                          |

## Notes from checking the reply

Five points needed more than the reply said. `docs/architecture/auth.md` ("API keys")
records how the settled ones are built.

1. **Settled: the login-domain policy.** `ALLOWED_LOGIN_DOMAINS` (`89da7eb`) is checked on
   sign-in and on every session, and a key skips both. The `/api/v1` helper (subtask 03)
   checks the key's user with `loginDomainAllowed` (`src/lib/login-domains.ts`) on each
   request.
2. **Settled: the lifetime is always explicit.** The server requires one of `30d`, `90d`,
   `1y`, and `none`, and the plugin's own default stays unset.
3. **Superseded by point 4: the per-key limit.** The plugin's limit was 60 requests whose
   gaps are all under 5 seconds, because its default of 10 requests a day would stop a
   menu bar item in minutes. Since 2026-10-09 the API counts 120 requests a minute per key
   in the app's rate-limit store, and the plugin's limit is off.
4. **Settled: our own key check, one read per request.** In 1.7.7 the plugin verifies a
   key with a read and two writes before the response (the rate-limit count with
   `last_request`, then `updated_at`). With the user lookup, that made four sequential
   Turso round trips, three of them writes on every poll. `deferUpdates: true` defers only
   the deletion of expired keys. Kait chose on 2026-10-09 to check keys without the
   plugin, over accepting the cost or moving the plugin to Upstash secondary storage
   (which would also move sessions there). `keyChecker` hashes the key as the plugin does,
   reads the key and its user in one query, counts the per-key limit in `rateLimitStore`,
   and saves `last_request` at most once a minute, beside the call. The plugin still
   creates keys; a test checks its hash against `hashKey`.
5. **Settled: a missing scope answers 403.** `verifyApiKey` refused a key without the
   asked-for permissions as 401 `KEY_NOT_FOUND`, like an unknown key. So the key check
   reads the key's `permissions` itself and answers 403
   `FORBIDDEN`, so a client can tell a wrong key from a read-only one.

Task 084's error body carries an `AppError`'s `code` and `key`, without its English
message. The key's own refusals and validation errors carry an English `message`. The API
doesn't translate keys: a client maps them to its own text, as the Raycast extension does.

## Subtasks

- [01: API keys](01-api-keys.md): the plugin, its table, and the Settings section
- [02: Device sign-in](02-device-sign-in.md): cancelled
- [03: API foundation](03-api-foundation.md): the shared helper, error mapping, and
  `docs/api.md`; the helper became `keyChecker`, which `signedIn` runs for a key
- [04: Endpoints](04-endpoints.md): the six `/api/v1` endpoints, now routes marked `keys`
- [05: Raycast extension](05-raycast-extension.md): the client, in its own repository
- [06: Custom expiry date](06-custom-expiry.md): optional; a key that ends on any chosen day

## Acceptance criteria

- [x] `docs/product.md` moves the API and the Raycast extension out of "Not in MVP"
- [ ] Subtasks 01 and 03–05 are done; 06 is optional
