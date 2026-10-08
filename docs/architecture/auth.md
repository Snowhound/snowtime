# Sign-in and security

## Sign-in methods

`DEMO_MODE=true` explicitly enables a deployed demo on local SQLite, or a Vercel preview
on the shared staging database ([Preview deployments](#preview-deployments)). It disables
OAuth even when credentials are present, enables seeded password sign-in, and disables
password sign-up. A box on the sign-in page explains that accounts and changes are
shared. The flag defaults to false and is read at runtime. The app refuses to start with
`DEMO_MODE=true` and a remote database anywhere but a preview, so a production database
can't be opened to the public seed password by mistake.
Full-year sample data is seeded explicitly, never at startup. Demo mode is for sample
data; company use starts with a fresh database and normal OAuth configuration.

`ALLOWED_LOGIN_DOMAINS` optionally restricts sign-in to a comma-separated list of
exact email domains, and a box on the sign-in page names them for internal use. The
server checks user creation, email changes, new sessions for every authentication
method, and existing sessions, including cached cookies. An empty list allows all
domains. The app refuses to start with both a list and `DEMO_MODE=true`, because the
seeded users have `example.com` addresses. The list supplies no organization
membership or other permissions.

| Method           | Status               | Enabled when                                                |
| ---------------- | -------------------- | ----------------------------------------------------------- |
| Email + password | Development and demo | `NODE_ENV=development` or `DEMO_MODE=true`; seeded users    |
| Google           | Implemented          | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set       |
| GitHub           | Implemented          | `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set       |
| Microsoft        | Implemented          | `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` are set |
| Passkey          | Implemented          | Always; `@better-auth/passkey` and its `passkey` table      |

- Social providers are built into Better Auth and store their link in `account`, so
  adding one is configuration plus an OAuth app and its client ID and secret per
  environment. `src/server/auth/sign-in.server.ts` builds both the Better Auth provider config
  and the method list from the env vars, so the two cannot disagree.
- The sign-in view shows only the configured methods. `getSignInMethods` runs signed out
  and returns method ids (`google`, `github`, `microsoft`, `password`, `passkey`), never
  secrets or display text.
- Each provider's OAuth app redirects to `<BETTER_AUTH_URL>/api/auth/callback/<id>`, for
  example `http://localhost:3100/api/auth/callback/github` locally. Providers match the
  redirect URL exactly and allow no wildcards, so OAuth sign-in works only on hosts
  registered in advance: local and production. A preview deployment on its own
  generated URL cannot use OAuth.
  - Google: one OAuth client can list the redirect URLs of every environment.
  - GitHub: an OAuth app lists up to 10 redirect URIs, so one app can serve every
    environment. A separate app per environment keeps a staging secret from signing in
    to production.
  - Microsoft: one Entra ID app registration can list several redirect URLs (web
    platform). Non-localhost URLs must use HTTPS. For the default `common` tenant, the
    app must accept accounts in any organizational directory and personal Microsoft
    accounts. `MICROSOFT_TENANT_ID` restricts sign-in to one tenant, for example in a
    dedicated stack for one client.
- Better Auth caches the session and user in a signed cookie for 5 minutes
  (`cookieCache`), so an API call doesn't read them from the database, which
  was 2 of its reads. The cost: a session revoked on another device, or an erased user,
  stays usable for up to 5 minutes where the cookie is. Organization access is still
  checked on every call, because `resolveScope` reads the `member` row.
- Profile edits go straight through the Better Auth client, as organization management does
  (see "Tenancy" in [data.md](data.md)): changing the name, linking and unlinking providers,
  and adding and removing passkeys. Better Auth checks that the session owns the account, and
  no Snowtime rule applies, so the API has no calls for them.
  - Better Auth's defaults apply. A provider links only when its email matches the
    user's. Unlinking and passkey changes need a session from the last day, and the last
    account can't be unlinked; passkeys don't count as accounts.
- The MVP sends no email. OAuth providers supply the verified email address that
  Better Auth requires before an invitation can be accepted
  (`requireEmailVerificationOnInvitation`), and admins share invitation links
  themselves. Password sign-in, which would need email for
  verification and reset, is enabled in local development and explicit demo deployments, where seeded users
  (task 008) sign in with a known password. The sign-in form lists the seeded users, and
  picking one fills in the email and password; `getDevUsers` returns the list only
  where password sign-in is enabled.
- A provider sign-up needs a verified address (task 042). `refuseUnverifiedSignUp` in
  `src/server/auth/sign-in.server.ts`, a `databaseHooks.user.create.before` hook, refuses
  any other, and the sign-in page says the provider hasn't verified the address. An
  unverified user would hold the address: Better Auth won't link a later, verified sign-in
  to it (`requireLocalEmailVerified`), so under Microsoft's `common` tenant anyone could
  sign up from a tenant they made up with someone else's address and lock its owner out.
  It also couldn't accept an invitation.
  - Google marks its addresses verified, and GitHub the ones its email list marks verified.
  - Microsoft verifies an address only in optional claims Better Auth reads
    (`email_verified`, `verified_primary_email`, `verified_secondary_email`), so
    `microsoftEmailVerified` also trusts a personal account (the consumer tenant, whose
    addresses Microsoft verified) and `xms_edov`, the claim that the tenant owns the
    address's domain. The app registration must add `xms_edov` to the ID token
    (`docs/deployment/README.md`); without it, work and school accounts can't sign up.
  - Checked against Better Auth 1.7's source and with sample claims, not yet with a real
    Microsoft or GitHub sign-in.
- Passkeys are added to an existing account: a signed-in user registers one, then signs
  in with it instead of their provider. Nobody signs up with a passkey alone.
  - After sign-in, the app frame offers to add one: above every signed-in page, for a day
    after sign-in (while Better Auth still lets the session add a passkey), to a user
    without a passkey, in a browser with WebAuthn. Adding one or choosing "Not now" hides
    it on that device (`snowtime.passkeyPromptDismissed` in localStorage), so a user is
    asked again on a new device, where a passkey helps.
- A passkey is bound to its relying party, the host of the app's URL (`BETTER_AUTH_URL`,
  or a preview's branch URL), so it works only in the environment where it was
  registered.
- Email provider when email is added: Brevo (free tier 300 emails a day, EU-based
  company), optional per deployment through env vars (task 016).
- Sign-up and sign-in screens are prototyped in `prototypes/auth.html`.
- An invitation link is `<app URL>/invitation/<id>`. Better Auth shows an
  invitation only to the invited user's session, but the screen must name the
  organization, team, inviter, and invited address before sign-in, so the reader knows
  which account to use. `getInvitation` returns those details signed out. The id is
  the link's only secret, as in Better Auth, and accepting still goes through Better
  Auth, which checks the address.
  - Once the invitation can't be accepted, a leaked or old link reveals less: an expired
    one returns only the inviter and organization names, so the screen can say whom to
    ask for a new link, and an accepted, rejected, or canceled one returns only that it
    is closed.
- Links last 48 hours (`invitationExpiresIn`). Better Auth ignores expired invitations
  when it checks for an open one, so a new link for an expired invitation is a new
  invitation; the Organization view then cancels the expired one. The view builds the
  link from the session's `appUrl` (`getAppSession`), the origin of the app's URL: the Better Auth
  client only knows the page's origin, which a proxy or a second domain can change.

### Preview deployments

Vercel preview deployments run against `snowtime-staging`, a Turso database seeded with
`bun run db:seed --company` and shared by every preview (task 087). Seeded users sign in with
the public seed password, through `DEMO_MODE=true` in Vercel's Preview environment. OAuth
callbacks can't follow generated hosts, and a separate staging flag was rejected: demo mode
already does what previews need, and its shared-accounts box is true of staging.

- The app's URL follows the preview host. When `VERCEL_ENV` is `preview`,
  `src/lib/app-url.ts` uses `https://$VERCEL_BRANCH_URL` as Better Auth's `baseURL`, the
  passkey relying party, and the invitation link origin, and Better Auth also trusts
  `https://$VERCEL_URL`. The branch URL stays the same across a branch's pushes, so
  invitation links keep working; the deployment URL is the one Vercel's PR comment links.
  `BETTER_AUTH_URL` must stay unset on previews, and the app refuses to start otherwise. A
  fixed preview domain was rejected because only the branch it's assigned to could sign in.
- The seed password is public in the repository, so Vercel Deployment Protection stays on
  for previews, and staging holds no real data.
- Previews have no Upstash and count rate limits in memory, so staging traffic doesn't
  count against production's limits.

## Cookies and consent

Snowtime asks for no cookie consent (task 038). The ePrivacy Directive, Article 5(3) (in
Estonia, the Electronic Communications Act § 102¹), requires consent to store anything on a
device unless it is strictly necessary for a service the user asked for. Everything below is
exempt under Criterion B of the Article 29 Working Party's Opinion 04/2012: sign-in cookies as
authentication, and the rest as user-interface customization. CNIL's 2020 guidelines
(Délibération 2020-091, Article 5) also exempt customization that is an intrinsic, expected
part of the service, which covers the intro, the passkey prompt's state, and the Entries
card's hint and list. The privacy policy (`src/features/legal/privacy-page.tsx`) lists these
items, and must change with them.

| Item                                         | Where        | Purpose                               | Lifetime                           |
| -------------------------------------------- | ------------ | ------------------------------------- | ---------------------------------- |
| `better-auth.session_token`                  | Cookie       | The session                           | 30 days, renewed daily while used  |
| `better-auth.session_data`                   | Cookie       | Session cache (see "Sign-in methods") | 5 minutes                          |
| `better-auth.state`                          | Cookie       | Checks the OAuth callback             | 5 minutes, during sign-in          |
| `better-auth-passkey`                        | Cookie       | The WebAuthn challenge                | 5 minutes, during a passkey step   |
| `PARAGLIDE_LOCALE`                           | Cookie       | The account's language                | 30 days, renewed on each page load |
| `snowtime.settings`                          | localStorage | Theme, app icon, and scene            | Until cleared                      |
| `snowtime.introSeen`, `snowtime.introSeason` | localStorage | Where the intro last played           | Until cleared                      |
| `snowtime.taglineSeen`                       | localStorage | The page tagline last shown           | Until cleared                      |
| `snowtime.passkeyPromptDismissed`            | localStorage | "Not now" on the passkey prompt       | Until cleared                      |
| `snowtime.reportEntriesNarrowed`             | Cookie       | Hides the Entries card's hint         | A year after the last change       |
| `snowtime.reportEntriesOpen`                 | Cookie       | The Entries card's list left open     | A year after the last change       |

On HTTPS, Better Auth prefixes its cookies with `__Secure-`.

- The session cookie outlives the browser session. Opinion 04/2012 exempts such a
  persistent login cookie only when sign-in announces it, for example "remember me (uses
  cookies)". Snowtime relies on the privacy policy, linked below the sign-in card, because
  users expect a web app to keep them signed in, and CNIL's guidelines exempt
  authentication cookies without that condition. If a regulator's view calls for it, a
  line under the sign-in buttons is the fix, not a consent prompt.
- The language cookie holds only a chosen language. Paraglide's `getLocale` writes the
  cookie on its first call in the browser, even when the language came from the browser's
  preference; `src/lib/locale-cookie.ts` skips that write while there is no cookie and the
  language matches the browser's. So a visitor who never signs in, or whose account
  language matches the browser, gets no cookie. Its 30 days (Paraglide's default is 400),
  renewed on each page load, outlast the 30-day session, which is renewed at most daily, so
  the sign-in page still shows in the last user's language after a lapsed session.
- `snowtime.settings` holds choices made in an Appearance menu, or the account's copy of them
  (see "User settings" in [timer.md](timer.md)), with no identifier. The intro and passkey
  keys hold one flag or season each.
- The Entries card's two flags are cookies, not localStorage, so the server renders the
  card as the browser left it (`src/lib/cookies.ts`). A card that grew after hydration
  would leave the page too short when the router restores the scroll on a reload. Each
  holds `1` or is absent.
- Adding analytics, error reporting that stores anything in the browser, a third-party
  script or embed, or any other cookie or storage key requires revisiting task 038 first:
  it may need a consent prompt, and the privacy policy lists every item.

## Abuse limits

Anyone who can sign in can create an organization, so caps keep one account from growing
the database, and the Turso quotas in `docs/hosting.md`, without bound. The values live in
`src/server/limits.server.ts` and sit far above honest use. Task 028 tracks the rest.

- The organization plugin enforces organizations per user (`organizationLimit`, which
  counts every organization the user belongs to), members, pending invitations, and
  teams per organization.
- `createProject` caps projects per organization, archived ones included.
- The invitation limit callback counts all live pending invitations in SQL. Better Auth
  1.7.7 fetches at most 100 pending rows before excluding expired ones, so its default
  count can admit invitations beyond the cap. The callback runs at the plugin's limit
  check, preserving earlier permission, existing-member, and duplicate refusals.
  Kait approved this correction for both servers on 2026-10-08.
- `createEntry` and `startTimer` cap a member's entries starting within 24 hours of the
  new one, either side. `updateEntry` checks the same when an entry's start moves,
  without counting the entry itself. The count is one range read on the
  `(organization_id, user_id, started_at)` index, so it stays cheap in Turso rows read.
  A day cap bounds entries per day, not in total; rate limiting covers a script spreading
  entries across years.
- A refused write throws `AppError` with code `LIMIT_REACHED`. Two concurrent writes can
  both pass a count and exceed a cap by one; a cap is a bound, not an exact number.

Names written through the Better Auth client have their length checked on the server too,
since the forms' schemas run only in the browser there. `src/server/auth/name-checks.server.ts`
runs the forms' own `Name` and `Slug` schemas (`auth.schemas.ts`), so both sides share one
limit, in two Better Auth hooks:

- The organization plugin's `organizationHooks` check the organization's name and slug on
  create and the name on update. The slug's format matters beyond the URL: the report
  export puts it in file names.
- The `user.update.before` database hook checks the profile's name. Sign-up isn't
  checked, since the OAuth provider supplies the name.

A refusal is an `APIError` with a code such as `NAME_TOO_LONG`, which `errorMessage` in
`src/lib/errors.ts` maps to the form's own message. The teams domain checks team names
with the same `Name` schema and returns translated `AppError`s.

Rate limits bound how fast one user or address can write, which the caps don't. The rates
are `rateLimits` in `src/server/limits.server.ts`.

- The API's session check (`signedInUser` in `src/server/auth/auth.server.ts`) counts every
  write against the user's write rate, across all their organizations, and refuses with
  `AppError` code `RATE_LIMITED` past it. Every call but a GET or a POST marked `reads` writes, so a new
  write is covered without extra code. The app's invitation call also applies the
  invitation rate per user before calling Better Auth.
- Better Auth limits `/api/auth/*` per IP address and path, in production only, with
  stricter rules for creating organizations and inviting members. Its per-IP rules stay
  loose because an office may share one address.
- Both keep their counts in one store (`src/server/rate-limit.server.ts`): a fixed
  window per key, counted and checked in one atomic step. With `UPSTASH_REDIS_REST_URL`
  and `UPSTASH_REDIS_REST_TOKEN` set, the store is Upstash Redis, one Lua script per
  counted request. Unset, the counts live in the process's memory. That is enough on one
  long-running server but not on Vercel, where each function instance counts on its own.
- Better Auth counts per address, which it reads from `x-forwarded-for` (set by Vercel),
  or from the header `CLIENT_IP_HEADER` names. Self-hosted, that is `cf-connecting-ip`,
  which Caddy sets to the address it trusts: Cloudflare's header from Cloudflare's ranges,
  otherwise the connection's. Without one trustworthy address, Better Auth counts every
  request under one key.
- Upstash was chosen over Better Auth's `storage: 'database'`, which would cost a Turso
  write per counted request, and over Vercel Firewall rules, which limit only per IP.
  Upstash is Redis over HTTP, so it doesn't tie the app to Vercel.
- Snowhound's Vercel deployment runs without Upstash, decided on 2026-10-03. Each counted
  write would wait for one round trip to Upstash, which offers no region nearer than
  Frankfurt to the Stockholm functions. Users are few, production has no password
  sign-in, and the caps above bound the database whatever the rates do. Each warm
  instance still stops a sustained flood from one user or address; a client spread over
  many instances gets the rate times the instance count. Add Upstash once abuse shows in
  the logs or the app opens to the public at scale. Self-hosted, one process counts
  exactly in memory.

## Content security policy

Every HTML response carries a Content-Security-Policy with a fresh nonce, so markup an
attacker gets into a page can't run scripts. `src/server-entry.ts` generates the nonce,
passes it to Start as request context, and sets the header; the policy itself is in
`src/server/csp.server.ts`.

- `script-src` allows only the nonce plus `'strict-dynamic'`. `getRouter` hands the
  nonce to the router (`ssr.nonce`), which puts it on its own scripts and Solid's, and
  the root route puts it on the theme script. A nonce was chosen over hashes because
  the router's hydration scripts differ on every page.
- `style-src` allows `'unsafe-inline'`: components render `style` attributes on the
  server, and a nonce can't cover attributes. Injected styles can restyle a page but
  not run code.
- `img-src` allows any `https:` host, for avatars from the sign-in providers.
  `font-src` allows `data:`, because the build inlines small font files.
- `frame-ancestors 'none'` stops other sites from framing the app (clickjacking).

The cost is one 16-byte random value and a header, about 2 µs per page. A per-page nonce
rules out caching the HTML in a shared cache, which none of the app's pages can do
anyway, since each one renders the signed-in user's session.

## Invitation acceptance after joining

Kait, 2026-10-08: a verified recipient who joined after an invitation was sent accepts
that still-live invitation using the existing membership. Keep its organization role,
mark the invitation accepted, activate the organization, and apply the invitation's
optional team assignment. Existing members do not consume another membership slot.
Recipient, verification, expiry, and status checks still apply; a repeated click refuses
as a closed invitation. Both the application wrapper and Better Auth endpoint use this rule.

Better Auth 1.7.7 inserts a member without checking existing membership. Snowtime's unique
index rejects that insert with HTTP 500 and Better Auth restores the invitation to pending.
The regression in `team-invitations.test.ts` confirms the repeated-failure path. Rejecting
and canceling would be smaller, but accepting takes a legitimate member where the valid
link promised. The app's before hook handles this case; new members keep Better Auth's
normal acceptance. An after hook applies team assignments to either path.
