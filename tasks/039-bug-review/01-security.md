# 01: Security

Status: done

Tenancy is the main risk: one organization's data must never reach another, and roles
must hold on every server function (`docs/architecture.md`, "Tenancy" and "Application
rules").

## Acceptance criteria

- [x] Every server function in `src/server/*/*.functions.ts` checks the session and the
      scope, and each `*.server.ts` query filters by the scope's organization
- [x] Role rules hold for member, team lead, admin, and owner: reads, writes, and
      moving data between users, teams, and projects
- [x] Removing a member, deleting a team, or leaving an organization takes away access
      at once, allowing only for the 5-minute session cookie cache
- [x] Signed-out endpoints (`getSignInMethods`, `getInvitation`, `getDevUsers`) return
      nothing beyond what the sign-in and invitation screens need
- [x] Better Auth configuration: trusted origins, cookie attributes, fresh-session
      rules, account linking by email, and passkey relying party
- [x] Redirect targets after sign-in (`src/lib/redirect.ts`) can't leave the site
- [x] CSV and XLSX exports neutralize formula injection (cells starting with `=`, `+`,
      `-`, or `@`)
- [x] CSP (`src/server/csp.server.ts`), rate limits, and input validation cover every
      endpoint; no secret or server-only module reaches the client bundle

## Findings

Reviewed on 2026-09-25 against the code at `b4b7251`, and Better Auth 1.7.6 and
TanStack Start 1.168.55 in `node_modules`.

### Fixed

- `safeRedirect` let through targets that the URL parser turns into another origin.
  Browsers drop tabs and newlines, so `/<tab>/evil.example` means `//evil.example`.
  Nothing left the site: TanStack Router refuses the redirect ("unsafe protocol") and
  Better Auth refuses the `callbackURL`. A signed-in user following such a link got
  the router's error page instead of the timer, and provider sign-in failed with
  "Invalid callbackURL". `safeRedirect` now resolves the target against a fixed origin
  and keeps it only if the origin stays the same (`auth.schemas.test.ts`).
- An admin could store an owner role that the app honored and Better Auth didn't.
  invite-member refuses `owner` from an admin, but its check splits the role list
  without trimming, so it accepts `member, owner` (reproduced against the dev
  database). Better Auth grants that string member rights, while `strongestRole`
  trimmed it and made the invitee an owner in every server function. `strongestRole`
  now splits as Better Auth does (`scope.test.ts`, `docs/architecture.md` "Tenancy").
- Hardening: `requireEmailVerificationOnInvitation: true` is now explicit. Better Auth
  turned it on only because a custom `generateId` is set, so dropping that option
  would have let unverified users accept invitations to their claimed address.

### Deferred

- Task 042: Microsoft, and GitHub without a verified address, sign users in with
  `emailVerified: false`, and those users can't accept invitations. With Microsoft's
  `common` tenant, an unverified sign-in can also claim someone else's address and
  lock its owner out. Read from the source, not reproduced: no Microsoft or GitHub
  sign-in is configured locally.
- Task 028: `/api/auth/update-user` stored a 3,000-character name (reproduced, then
  restored), and the organization slug has no server-side format check. Server
  functions count only POST calls against a rate, so reads such as `getReport` have
  none.
- Subtask 02: Better Auth's Drizzle adapter runs without transactions
  (`transaction: false`). A failure partway through accept-invitation can leave
  `team_member` rows for a user who isn't a member.

### Checked and sound

- Server functions: every function in `src/server/*/*.functions.ts` uses
  `scopeMiddleware`, except these:
  - Settings, `stopTimer`, and `getRunningTimer` use `sessionMiddleware` and act only on
    the user's own rows. The timer functions also require membership of the entry's
    organization.
  - The signed-out auth functions use none.
- Queries: every query in the `*.server.ts` files filters by the scope's organization,
  through `live()` or `organization_id`. The only exceptions are subqueries keyed by
  ids already in it (team ids, a project's id).
- Server function handling in Start: its CSRF middleware refuses a request with no
  `Sec-Fetch-Site`, `Origin`, or `Referer`. The handler refuses a POST function called
  with GET.
- Role rules:
  - Members write only their own entries, and leads only read their teams'.
  - Only admins and owners write others' entries, manage projects, and set team roles.
  - An entry can't move to another user.
  - A project must be visible to the actor. Its team must be in the organization,
    which the composite foreign key backs.
  - Reports and exports use `readableUserIds` and led teams. The tests cover each role.
- Better Auth's organization plugin checks (read with a subagent, spot-checked):
  - Organization, member, team, and invitation endpoints check membership and
    permission in the target organization.
  - A team from another organization is refused.
  - add-team-member requires the user to be an organization member.
  - Admins can't grant owner through update-member-role, or remove or demote an owner.
  - The plugin never writes `team_member.role`, so re-adding a lead keeps the role.
- Access after removal: `resolveScope` reads `member` and led teams on every call, so
  removing a member, deleting a team, or leaving takes effect on the next call. Better
  Auth deletes the user's `team_member` rows when a member is removed or leaves, and a
  team's rows when the team is deleted. The after hook reads `returned` correctly for
  both remove-member (`{ member }`) and leave (the member row).
- Signed-out endpoints:
  - `getSignInMethods` returns method ids only.
  - `getDevUsers` is empty unless password sign-in is on.
  - `getAppUrl` returns the public origin.
  - `getInvitation` returns only what each state's screen uses; `organizationId` is
    needed for `setActive` after accepting.
  - A malformed invitation id shows the closed screen.
  - Invitation ids are UUIDv7 from `uuid` 14, which keeps at least 42 random bits per id
    even within one millisecond, so they can't be guessed.
- Better Auth configuration:
  - `trustedOrigins` defaults to the `BETTER_AUTH_URL` origin. A cross-origin sign-in
    POST got 403, and absolute and protocol-relative callback URLs were refused.
  - Cookies are `HttpOnly` and `SameSite=Lax`, and `Secure` with the `__Secure-`
    prefix under an https base URL.
  - `freshAge` is 24 hours. Passkey registration requires a fresh session, and passkey
    changes check ownership. The relying party and origin come from `BETTER_AUTH_URL`.
  - Implicit account linking needs a provider-verified email and a verified local user.
  - Better Auth skips its origin check when `NODE_ENV` is `test` or `TEST` is set, so a
    deployment must set neither.
- Exports: CSV cells starting with `=`, `+`, `-`, `@`, a tab, or a carriage return get an
  apostrophe before quoting. XLSX writes text as strings, never formulas.
- CSP: every HTML response carries it, including Better Auth's error page. The only
  `innerHTML` is the constant theme script. `public/` holds only images.
- Input validation: every server function with input has a Valibot validator, and
  `v.object` drops unknown keys.
- Client bundle: the 13:17 build in `.output/public/assets` holds no secret,
  `libsql`, `drizzle-orm`, seed password, or router devtools. The only
  `BETTER_AUTH_SECRET` is Better Auth's client env getter, with no value.
