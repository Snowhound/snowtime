# 01: API keys

Status: todo

Users create, list, and revoke personal API keys in Settings. The keys sign in only to
`/api/v1` (subtask 02).

## Acceptance criteria

- [ ] `@better-auth/api-key` is added at `1.7.6`, pinned as `@better-auth/passkey` is, and
      enabled in `src/server/auth/better-auth.server.ts` before `tanstackStartCookies()`
- [ ] The plugin's options: `defaultPrefix: 'snow_'`, `enableSessionForAPIKeys: false`,
      and no `defaultExpiresIn` (README, point 2)
- [ ] The per-key rate limit is rechecked against a polling client and set with numbers
      (README, point 3)
- [ ] Before setting `deferUpdates`, the user is asked about the write per request
      (README, point 4)
- [ ] The key name's length limit matches the form's schema; the plugin's default is 32
      characters
- [ ] A hand-written migration adds the plugin's table (`docs/migrations.md`), with
      `reference_id` referencing `user(id)` `ON DELETE CASCADE`, and an index on it for the
      Settings list
- [ ] The DBML in `datamodel/` shows the table (`bun run datamodel`)
- [ ] Creating a key goes through a server function, not the Better Auth client, because
      the plugin accepts `permissions` only from the server. It takes a name, a required
      lifetime (`30d`, `90d`, `1y`, or `none`), and scopes (`read`, or `read` and `write`).
      The form preselects `90d`
- [ ] An "API keys" card in `src/features/settings/` lists each key's name, prefix,
      creation date, expiry, and last use, with a Revoke button. A new key shows in full
      once, with a copy button, and never again
- [ ] Listing and revoking show only the user's own keys; a test revokes another user's
      key and gets refused
- [ ] English and Estonian strings for the card and its errors
- [ ] `docs/architecture/auth.md` gets an "API keys" section: how keys are issued, stored
      (hashed), scoped, expired, revoked, and rate limited, and why they reach only
      `/api/v1`. The cookie table there is unchanged, because keys never reach the browser
- [ ] The privacy policy (`src/features/legal/privacy-page.tsx`) mentions that a key's last
      use is recorded, if `lastRequest` stays (README, point 4)
