# 028: Abuse limits

Status: in-progress

Anyone who can sign in can create an organization, and that stays. Bots should still
not fill the Turso database or its free-tier quotas (`docs/hosting.md`). OAuth-only
sign-in already means every account is a real Google, GitHub, or Microsoft account.
Passkeys can only be added to an existing account. These criteria cover what that leaves
open.

## Acceptance criteria

- [x] Better Auth's rate limiter works across Vercel instances. Better Auth turns it on in
      production but keeps counts in memory by default, and each function instance
      has its own memory. Done with `customStorage` on Upstash Redis; `secondaryStorage`
      would also have moved sessions into Redis, and `storage: 'database'` costs a Turso
      write per counted request.
- [x] `customRules` in Better Auth's `rateLimit` set stricter limits for
      `/organization/create` and `/organization/invite-member`.
- [x] Each organization has caps set well above honest use, so one account can't grow a
      tenant without bound:
  - the organization plugin's `membershipLimit` (default 100), `invitationLimit`
    (default 100), and `teams.maximumTeams`, set on purpose
  - projects per organization, and entries per member per day, checked by the server
    functions that create them, with an error from the catalog in `src/server/errors.ts`
- [x] `organizationLimit` caps how many organizations one user can create (unlimited by
      default).
- [x] Server functions that write (entries, projects, teams) have a per-user limit.
      Better Auth's limiter covers only `/api/auth/*`.
- [ ] Names written through the Better Auth client (organization, team) are
      length-checked on the server too, for example in the plugin's
      `organizationHooks`. The form schemas run only in the browser there; server
      functions already check theirs, such as the 500-character `Description`.
- [ ] Vercel Firewall: bot protection and a rate-limit rule on the app, if the plan
      in use allows them (check against the plan decided in `docs/hosting.md`).
- [x] The limits (done) and the storage choice are recorded in `docs/architecture.md`.
