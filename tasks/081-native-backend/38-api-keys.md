# 081.38: Personal API keys

Status: done

Bring the native backend up to `main` at `1eedd18`, task 093's personal API keys on the
JSON API, so a TypeScript server and a native server can run against one database. The
sources are `main`'s `src/server/http.server.ts`, `auth/api-keys.server.ts`,
`auth/auth.server.ts`, `auth/auth.routes.ts`, and `limits.server.ts`, and
`@better-auth/api-key` 1.7.7 for the row a key is created with. Branch `081-native-poc`,
merged with `main` in `07fc18d`. No Docker, load, or stress runs.

## Acceptance criteria

- [x] `main` merged. Its `5720983` and the branch's `7b4f92c` (the `livez` and `readyz`
      slugs) were the same change and merged without conflicts.
      `drizzle/20261009115520_api_key` needs no code: `migrations.rs` reads every migration
      folder at startup.
- [x] `known`: `Authorization: Bearer <key>` on a `/api/v1` route not marked `keys`
      answers 403 `FORBIDDEN` "API keys cannot make this call.", public routes included,
      after the unknown-call 404 and before the Origin check, which a key's request
      skips. `http::KEYS` marks a handler, as Hono's `keys` does: `GET /me`, `GET /timer`,
      `POST /timer/stop`, `POST /organizations/:id/timer/start`, and `GET` entries and
      projects. Better Auth's routes ignore the header.
- [x] `signedIn` with a key (`auth/api_keys.rs`, `key_user`): the key alone signs the
      request in, and the cookie is dropped when the request is read. One query reads the
      key joined to its user by its hash (SHA-256, unpadded base64url). The refusals, in
      `keyChecker`'s order: unknown or disabled 401, expired 401 (from the moment it
      ends), read-only on a write 403, user outside `ALLOWED_LOGIN_DOMAINS` 401, each as
      `{code, message}`. Then `api-key:{id}` counts at 120 per 60 s in the app's
      rate-limit store (429 `RATE_LIMITED`), and a write also counts `write:{user}`; both
      count before either refuses, as `Promise.all` does. The check is timed as `session`.
- [x] `last_request` is saved when it's null or at least 60 s old, and the answer waits for
      it; a failed save is logged. See "Differences" for where it runs.
- [x] Routes `GET /me`, `GET` and `POST /api-keys`, and `DELETE /api-keys/:id`, with
      `CreateApiKeyInput`'s name rules (trimmed, non-empty, at most 32 UTF-16 units), the
      cap of 25 keys counting expired ones (422 `LIMIT_REACHED` `api_key_limit`), the list
      newest first in `listApiKeys`'s field order with access from the permissions, and
      revoking only the user's own key (404 `api_key_not_found`).
- [x] `create_api_key` writes the plugin's row. Keys are `snow_` and 64 letters from
      `a-zA-Z`, uniformly, as `defaultKeyGenerator` makes them. The row: a UUIDv7 id,
      `config_id` `'default'`, the trimmed name, `start` null, `prefix` `snow_`,
      `enabled` 1, `rate_limit_enabled` 0, `rate_limit_time_window` 86400000,
      `rate_limit_max` 10, `request_count` 0, `expires_at` from the lifetime or null,
      `created_at` = `updated_at`, the permissions JSON, and `metadata` as the text
      `'null'`. The plugin's schema JSON-encodes a missing metadata value, which only a
      row read back from the TypeScript server showed. Creating also deletes expired keys
      at most once in 10 s per process, as the plugin's `deleteAllExpiredApiKeys` does.
- [x] English for a key's requests: the native API has no locale selection, so every
      validation message is English, whatever the cookie or `Accept-Language`. Pages
      never send a key; the render isolate's API calls carry only the page's cookie.
- [x] Settings renders the API keys card. Its loader reads `listApiKeys` through the
      in-process transport, and the server-rendered page shows a seeded key on both
      servers.
- [x] Rust tests beside the code: 12 in `auth/api_keys/tests.rs` (the hash against two
      keys the plugin made, the bearer pattern, the generator, the created row, the name
      and lifetime refusals, the cap, the expired-key deletion and its throttle, list and
      revoke, every refusal, the per-key and per-user rates, the once-a-minute last use,
      and a failed save) and 3 router tests in `http/tests.rs` (the `keys` marks and the
      Origin skip, the cookie ignored and the last use saved through a reader, and a
      failed key read going to the API's database error, not a refusal).
- [x] `native/bench/api-keys-compare.ts`, run by `compare.ts`: 81 calls, the key's checks,
      the calls a key reaches and those it can't, Settings' calls, 26 creates up to the
      cap, the 121st call in a minute, and the rows of new keys column by column. Each
      server's key, its row copied to the other server's database, signs in on both.
      `calls.ts` names the four new calls.

## Differences from TypeScript

- The last-use save can't run beside the rule on one SQLite writer. A call on the writer
  saves it in the same job, after the rule. A call on a reader can't write, so `answer`
  saves it through the writer's lane once the reader is done, and answers after that; a
  refused or failed save is logged.
- `permissions` that aren't JSON count as read access. `accessOf` would throw, answering 500. Only a server writes the column.
- The 503 path isn't exercised by a test: a failed key read becomes `Error::Database`
  and goes through `unavailable_or`, but a local SQLite file can't be made to fail
  `select 1` without rusqlite's hooks feature, so the router test checks the 500 of a
  database that still answers.
- Native rate limits stay off in development unless `RATE_LIMIT=on`, as before; the
  per-key limit shares that switch. `compare.ts` and the cap and rate cases run with it on.

## Verification

Run 2026-10-09 on macOS arm64 with the commands in 30-audit.md's "Parity record" and
29-hardening.md's "Repeat the checks", conformance and `compare.ts` on the `bench` host.
"Before" is the merge commit `07fc18d`, whose Rust is `9c2ffdc`'s.

| Check                    | Before                                | After                |
| ------------------------ | ------------------------------------- | -------------------- |
| Server tests, each mode  | 123                                   | 138                  |
| Host tests               | 36                                    | 36                   |
| Render tests             | 18, 1 ignored                         | 18, 1 ignored        |
| Conformance              | 55 / 542 in 12 files (`api-keys` new) | 66 / 570 in 13 files |
| `compare.ts` byte-equal  | 1,409                                 | 1,490                |
| `hardening-compare.ts`   | 17 checks                             | 17                   |
| `page-compare.ts`        | 59 / 59                               | 57 / 59, see below   |
| `cargo deny`, both modes | pass                                  | pass                 |
| `cargo audit`            | pass                                  | pass                 |

`conformance/api-keys.conformance.ts` passes 11 of 11. `cargo fmt --check`, both Clippy
runs, and oxlint on the bench scripts pass.

`page-compare.ts` ran against a control host built from `07fc18d`'s Rust with the same,
rebuilt render bundle. The 57 other pages are byte-equal. Settings as admin and as member
differ because the control has no `listApiKeys`: its loader's call answers 404, and the
control renders those pages as 500, while this branch renders them with 200. No control
both renders the new frontend and has the route, so a seeded key on the Settings page
was checked instead, on the TypeScript server and this host alike.
