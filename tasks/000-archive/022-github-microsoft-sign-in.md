# 022: GitHub and Microsoft sign-in

Status: done

Add the two remaining decided OAuth providers next to Google, and tell the sign-in view
which methods an environment has configured, so it shows only those.

## Acceptance criteria

- [x] Optional `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` and
      `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`, plus `MICROSOFT_TENANT_ID`; each
      pair is both-or-neither, validated at startup in `src/env.ts`
- [x] `src/lib/auth.ts` enables each provider whose pair is set
- [x] `getSignInMethods` in `src/functions/auth.ts` runs signed out and returns only
      method ids: `google`, `github`, `microsoft`, `password` (development only), `passkey`
- [x] The rule that builds the list is a pure function in a `*.server.ts` module, with tests
- [x] `docs/architecture.md`: env var list, sign-in table, redirect URLs per provider and
      environment, and profile edits going through the Better Auth client
