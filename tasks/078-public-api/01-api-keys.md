# 01: API keys

Status: done

Users create, list, and revoke personal API keys in Settings. The keys sign in only to
`/api/v1` (subtask 02).

## Acceptance criteria

- [x] An "API keys" card is prototyped in `prototypes/settings.html` before any Solid code,
      following `prototypes/README.md` ("Workflow"):
  - the list: each key's name, scopes, creation date, expiry, and last use, with
    Revoke, which asks for confirmation in a `<dialog>`;
  - creating a key: name, lifetime (`30d`, `90d`, `1y`, or `none`, with `90d` preselected),
    and scopes (read only, or read and write);
  - the new key shown once in full, with a copy button and a line saying it won't be shown
    again;
  - fixtures for no keys, several keys, a long name, a key that expires soon, a key with no
    expiry, and a key never used
- [x] The prototype passes the checks in `docs/skills/ui-review/SKILL.md`, at 390 px wide and
      on desktop, in light and dark themes, and `prototypes/README.md` has a reference entry
      for it
- [x] The user approves the prototype before the card is built in Solid
- [x] `@better-auth/api-key` is added at `1.7.6`, pinned as `@better-auth/passkey` is, and
      enabled in `src/server/auth/better-auth.server.ts` before `tanstackStartCookies()`
- [x] The plugin's options: `defaultPrefix: 'snow_'`, `enableSessionForAPIKeys: false`,
      no `defaultExpiresIn` (README, point 2), and
      `startingCharactersConfig.shouldStore: false`, so no part of a key is stored or shown
      after it's created
- [x] The per-key rate limit is rechecked against a polling client and set with numbers
      (README, point 3)
- [x] `deferUpdates: true` (README, point 4). It defers only the deletion of expired keys,
      not the last-use write; point 4 is open again for subtask 02
- [x] The key name's length limit matches the form's schema; the plugin's default is 32
      characters
- [x] A hand-written migration adds the plugin's table (`docs/migrations.md`), with
      `reference_id` referencing `user(id)` `ON DELETE CASCADE`, and an index on it for the
      Settings list
- [x] The DBML in `datamodel/` shows the table (`bun run datamodel:generate`)
- [x] Creating a key goes through a server function, not the Better Auth client, because
      the plugin accepts `permissions` only from the server. It takes a name, a required
      lifetime (`30d`, `90d`, `1y`, or `none`), and scopes (`read`, or `read` and `write`).
      The form preselects `90d` and read only, the least access
- [x] The "API keys" card in `src/features/settings/`, built from the approved prototype,
      lists each key's name, access, creation date, expiry, and last use, with a Revoke
      button. A new key shows in full once, with a copy button, and never again
- [x] Listing and revoking show only the user's own keys; a test revokes another user's
      key and gets refused
- [x] English and Estonian strings for the card and its errors
- [x] `docs/architecture/auth.md` gets an "API keys" section: how keys are issued, stored
      (hashed), scoped, expired, revoked, and rate limited, and why they reach only
      `/api/v1`. The cookie table there is unchanged, because keys never reach the browser
- [x] The privacy policy (`src/features/legal/privacy-page.tsx`) mentions that a key's last
      use is recorded
