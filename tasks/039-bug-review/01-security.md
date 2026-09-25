# 01: Security

Status: todo

Tenancy is the main risk: one organization's data must never reach another, and roles
must hold on every server function (`docs/architecture.md`, "Tenancy" and "Application
rules").

## Acceptance criteria

- [ ] Every server function in `src/server/*/*.functions.ts` checks the session and the
      scope, and each `*.server.ts` query filters by the scope's organization
- [ ] Role rules hold for member, team lead, admin, and owner: reads, writes, and
      moving data between users, teams, and projects
- [ ] Removing a member, deleting a team, or leaving an organization takes away access
      at once, allowing only for the 5-minute session cookie cache
- [ ] Signed-out endpoints (`getSignInMethods`, `getInvitation`, `getDevUsers`) return
      nothing beyond what the sign-in and invitation screens need
- [ ] Better Auth configuration: trusted origins, cookie attributes, fresh-session
      rules, account linking by email, and passkey relying party
- [ ] Redirect targets after sign-in (`src/lib/redirect.ts`) can't leave the site
- [ ] CSV and XLSX exports neutralize formula injection (cells starting with `=`, `+`,
      `-`, or `@`)
- [ ] CSP (`src/server/csp.server.ts`), rate limits, and input validation cover every
      endpoint; no secret or server-only module reaches the client bundle
