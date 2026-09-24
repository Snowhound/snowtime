# 015: Passkey sign-in

Status: done

Passkeys are a proposed sign-in method (`docs/architecture.md`, "Sign-in methods").
They need `@better-auth/passkey` and one new `passkey` table: an additive migration
that changes no existing table.

## Acceptance criteria

- [x] Passkey moved from proposed to decided in `docs/architecture.md`
- [x] `passkey` table added to `datamodel/snowtime.dbml`, shape taken from the installed
      plugin's schema source
- [x] Migration via `bun run db:generate add_passkey`; `schema.ts` updated;
      `bun run db:drift` clean
- [x] Plugin configured with the relying-party ID and origin from env, per environment
- [x] Register, sign in, and remove a passkey work locally (checked against the auth
      handler with a software authenticator; no UI calls it yet)
