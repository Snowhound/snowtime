# 081.28: Complete the native auth port

Status: done

Kait reviewed and approved step 4 on 2026-10-08. All four steps are complete.

Close the functional gaps so a native-only host serves every call the app makes.
TypeScript and installed Better Auth 1.7.7 remain the source of truth. Follow
[081.26](26-functional-port.md). Work on `081-auth-port`, from `081-native-poc` at
`6e8a18b`, in `/private/tmp/snowtime-081-auth-port`.

## Steps and acceptance criteria

1. Invitation acceptance:
   - [x] Port `POST /api/v1/invitations/:id/accept` and Better Auth's
         `POST /api/auth/organization/accept-invitation`.
   - [x] Run invitation conformance without the acceptance exclusion.
   - [x] Compare fresh database copies, including success, optional team assignment,
         wrong recipient, expired, canceled, and already-member cases.
   - [x] Stop after step 1. Give Kait the commit range, verification counts, and commands
         for two local hosts with separate seeded database copies.
2. Passkeys:
   - [x] Port registration, sign-in, listing, and removal as the app uses them.
   - [x] Start from [the auth spike](auth-spike.md), branch `081-auth-spike`; record
         the chosen crates and reasons. The method list already advertises passkeys.
3. Google/OAuth:
   - [x] Match Better Auth's state, PKCE, callback, and account-linking behavior.
   - [x] Use a local fake provider for both comparison servers; record what it cannot prove.
4. Remaining client calls:
   - [x] Show Kait the audited missing-route list below before porting this step.
   - [x] Port every remaining organization write and profile update in that list.

For every step:

- [x] Read the TypeScript domain and installed Better Auth source before porting.
      Ask Kait about suspect rules. A TypeScript behavior change requires a decision
      in `docs/architecture/`; don't change it silently.
- [x] Put routes in the domain's `routes.rs`, with one rule call per handler.
      Validate in Valibot or Zod order, with matching messages, before deserialization.
- [x] Add byte-equal comparisons to `native/bench/compare.ts`, conformance in
      `conformance/`, and handler rows in `native/bench/lines.ts`.
- [x] Centralize Rust's invitation and team caps to mirror `limits.server.ts`.
- [x] Before implementation commits, run `cargo fmt`; workspace Clippy
      `--all-targets -- -D warnings`, with and without `--features bench`; server tests
      with and without `bench`; host tests; affected files through
      `native/bench/conformance.ts`; and `compare.ts`.
- [x] Record counts and save output under `auth-port/stepN/` here. Update the ported
      and not-ported list in `native/README.md` and the Open notes in subtask 01.

No Docker, load, or stress runs. Don't push, rebase, or merge without Kait's approval.

## Missing-route audit

Audit at `6e8a18b`: inspect all `src/server/*/*.routes.ts`, the Rust domain routers,
and production `authClient` calls under `src/`, including installed passkey client
subrequests. Existing email sign-in and sign-out are ported.

The only application API route without a Rust counterpart is
`POST /api/v1/invitations/:id/accept` (step 1).

At the base commit, the following Better Auth paths under `/api/auth` returned 404.
Steps 1–3 now cover acceptance, the six passkey endpoints, and OAuth/account management.
Step 4 is now implemented.

| Method   | Path                                     | Client use                                 | Step |
| -------- | ---------------------------------------- | ------------------------------------------ | ---- |
| GET      | `/passkey/generate-register-options`     | Add passkey                                | 2    |
| POST     | `/passkey/verify-registration`           | Add passkey                                | 2    |
| GET      | `/passkey/generate-authenticate-options` | Sign in with passkey                       | 2    |
| POST     | `/passkey/verify-authentication`         | Sign in with passkey                       | 2    |
| GET      | `/passkey/list-user-passkeys`            | Settings and passkey prompt                | 2    |
| POST     | `/passkey/delete-passkey`                | Remove passkey                             | 2    |
| POST     | `/sign-in/social`                        | Social sign-in                             | 3    |
| GET/POST | `/callback/:id`                          | Provider callback, reached through sign-in | 3    |
| POST     | `/link-social`                           | Link provider account                      | 3    |
| GET      | `/list-accounts`                         | Settings sign-in methods                   | 3    |
| POST     | `/unlink-account`                        | Remove provider account                    | 3    |
| POST     | `/update-user`                           | Profile name                               | 4    |
| POST     | `/organization/set-active`               | Header switcher and invitation page        | 4    |
| POST     | `/organization/check-slug`               | Create organization                        | 4    |
| POST     | `/organization/create`                   | Create organization                        | 4    |
| POST     | `/organization/update`                   | Rename organization                        | 4    |
| POST     | `/organization/update-member-role`       | Member role                                | 4    |
| POST     | `/organization/remove-member`            | Remove member                              | 4    |
| POST     | `/organization/cancel-invitation`        | Cancel or replace invitation               | 4    |

The app accepts through the application API wrapper, rather than calling the
Better Auth client directly. Step 1 also ports `/organization/accept-invitation`
so the corresponding Better Auth endpoint behaves consistently. There are no
production calls to reject invitations, leave/delete organizations, or update passkeys.

## Verification

### Step 1

Verified on macOS arm64 on 2026-10-08. At completion of step 1, steps 2–4 were pending.
Kait approved fixing the TypeScript already-member crash with the recorded option 2
in [the auth decision](../../docs/architecture/auth.md#invitation-acceptance-after-joining).
The scope commit is `2583c0c`; the isolated TypeScript fix is `1222cf2`, and the native
implementation is `1397ee5`. Kait reviewed and approved applying the TypeScript fix to
`main`, where it is committed as `c0e7d43`. The transplant preserves `main`'s existing
invitation-limit code and includes no native changes.

- `cargo fmt` and workspace Clippy, both without and with `bench`, pass.
- Server tests: 66 pass without `bench`, and 66 with it. Host tests: 16 pass.
- Invitation, session, and team conformance: 17 pass, 51 assertions. No name filter is set;
  invitation conformance alone has 6 tests and 16 assertions, including the restored
  recipient-refusal test and a new acceptance/team-assignment test.
- TypeScript invitation, team-invitation, and auth-schema tests: 24 pass, 77 assertions.
  The saved upstream reproduction confirms HTTP 500 and the restored pending state.
  Regressions cover preserving the existing role, closing the link, active organization,
  team assignment on the direct Better Auth path, and all recipient/state safeguards.
- Comparison: all 934 calls are byte-equal, including 54 acceptance calls. Both endpoint
  sequences use fresh independent database copies, covering wrong recipient, expired,
  canceled, already accepted, existing member, new member, repeat click, origin, session,
  malformed JSON, and ordered Zod string validation. Reads check closed previews,
  organization roles, team membership, and active organization after each acceptance.
- On `main`, invitation, team-invitation, auth-schema, and login-policy tests pass:
  28 tests, 96 assertions. Invitation HTTP conformance passes: 5 tests, 16 assertions.
  Its existing combined refusal test remains combined. The pre-commit lint, format,
  and Knip checks pass. See `main-ts-tests.log` and `main-conformance.log`.
- Frontend and render-bundle builds, changed-file lint, and all three Knip configurations
  pass. Full `tsc --noEmit` still reports existing native benchmark dependency and
  shared-props AST errors; it reports no errors in changed files. See `types.log`.

Saved outputs are in [auth-port/step1](auth-port/step1/). Run from the worktree root:

```sh
cargo fmt --all --manifest-path native/Cargo.toml
cargo clippy --manifest-path native/Cargo.toml --workspace --all-targets --offline -- -D warnings
cargo clippy --manifest-path native/Cargo.toml --workspace --all-targets --features bench --offline -- -D warnings
cargo test --manifest-path native/Cargo.toml -p snowtime-server --offline
cargo test --manifest-path native/Cargo.toml -p snowtime-server --features bench --offline
cargo test --manifest-path native/Cargo.toml -p snowtime-host --offline
cargo build --manifest-path native/Cargo.toml -p snowtime-host --offline
bun test src/server/auth/team-invitations.test.ts src/server/auth/invitations.test.ts src/server/auth/auth.schemas.test.ts
bun native/bench/conformance.ts native/target/debug/snowtime-axum conformance/invitations.conformance.ts conformance/session.conformance.ts conformance/teams.conformance.ts
bun native/bench/compare.ts native/target/debug/snowtime-axum
bun native/bench/lines.ts
```

The `*-verified.log` files contain the final Rust and HTTP checks. `already-member-before.log`
records the installed Better Auth failure before the fix. No Docker, load, or stress runs.

Patterns for subtask 05:

- Application acceptance validates its path ID with Valibot rules after the session and
  write-rate checks. Better Auth validates `invitationId` as a Zod string, without UUID
  validation, before session middleware; it retains Better Auth's unwrapped refusal shape.
- A nested Better Auth middleware can return a headers envelope when the outer hook sets
  `returnHeaders`. Pass `returnHeaders: false` when forwarding its response from a composed
  before hook. Otherwise a signed-out session read can receive that envelope as its result.
- Existing members keep their organization and team roles, and acceptance does not add
  another member or consume another slot. The existing-member transition includes team
  assignment in one transaction. A new member follows Better Auth's acceptance, then the
  app's separate team-assignment transaction. A failed latter step can leave the organization
  membership accepted; an admin repairs the team, as the existing TypeScript contract records.
- Pair generated membership IDs explicitly, including when the application wrapper returns
  only the invitation ID. Check UUIDv7 before pairing. Mask only advancing-clock fields
  (`createdAt`, `joinedAt`), while supplied IDs, roles, statuses, and key order remain exact.
- Native account caps are centralized in `native/crates/server/src/limits.rs`, mirroring
  `src/server/limits.server.ts`; invitation, team, and acceptance membership checks use them.

| Handler or helper                                   | TypeScript | Rust |
| --------------------------------------------------- | ---------: | ---: |
| Application acceptance wrapper                      |         16 |   10 |
| Better Auth acceptance rule / native full rule      |        105 |  153 |
| App acceptance hooks (included in native full rule) |         70 |    0 |
| Better Auth schema / native HTTP entry              |          1 |   49 |
| Better Auth schema / native ordered validation      |          1 |   26 |

The installed Better Auth version is 1.7.7, matching this branch's package manifest.
The spike still documents its earlier target version; crate adoption belongs to step 2.

### Step 2

Verified on macOS arm64 on 2026-10-08. Passkey registration, sign-in, listing, and removal
are implemented. Kait approved step 1 and asked to stop after step 2. Google/OAuth and
remaining organization/profile writes remain pending. No TypeScript auth behavior changes.
The requested seed import correction is `b7c2349` on `main` and `dbad70a` on
`081-auth-port`.

Read the app's auth configuration, settings mutations, sign-in action, installed
`@better-auth/passkey` 1.7.7 server/client, and `@simplewebauthn/server` 13.3.3 before
porting. The `081-auth-spike` storage adapter and ceremony tests supply the COSE mapping
and identify the published Better Auth Rust plugin's UV=false registration failure.

Crates:

- `webauthn-rs-core =0.5.5`: reuse the spike's verifier and existing COSE rows, with
  TypeScript's preferred user-verification policy. The published Better Auth Rust plugin
  requires verification for registration, so it remains unmounted. The higher-level
  passkey wrapper's policy and credential envelope do not match this port's contract.
  The [core API](https://docs.rs/webauthn-rs-core/0.5.5/webauthn_rs_core/struct.WebauthnCore.html)
  puts policy and state handling in the caller. Snowtime binds the exact RP and origin,
  verifies signed challenge cookies, consumes persisted challenges once, binds registration
  to a fresh session and its user, and preserves counter checks. The exact pin prevents
  changes to the reconstructed state/credential format without review.
- `serde_cbor_2` 0.13.0: decode persisted COSE keys as in the spike. Registration stores
  the authenticator's original COSE bytes, including their map order, without adding
  columns or a process cache.
- `openssl` 0.10.81 with `vendored`: the WebAuthn core's cryptography dependency is built
  into the host, so deployment needs no shared OpenSSL library. The native image's build
  installs Perl and make for that build. No Docker build or Linux verification was run.

Checks and output in [auth-port/step2](auth-port/step2/):

- Formatting and workspace Clippy with all targets and warnings denied pass, without
  and with `bench`.
- Server tests: 69 pass without `bench`, and 69 with it. Host tests: 16 pass.
- Native passkey, invitation, session, and team conformance: 18 pass, 178 assertions.
  The TypeScript passkey reference test passes: 1 test, 127 assertions.
- Comparison: 1,071 calls answer with the same bytes, including 137 passkey cases.
  ES256, Ed25519, and RSA cover UV=false registration/sign-in, UV=true sign-in, backed-up
  multi-device credentials, backup-flag transitions, raw COSE bytes, optional registration
  session creation, discovery and session options, exclusion lists, listing, and removal.
  Refusals cover Zod ordering, HTTP and ceremony origins, missing/tampered/expired
  challenges, replay, wrong challenge, invalid signature, absent user presence, stale
  counters, wrong registration/deletion owner, wrong ceremony, and removed credentials.
- Separate seeded copies cover imported COSE keys in fresh server processes, authenticators
  without counters, expired challenges, and registration's 24-hour freshness boundary.
  Better Auth's deletion endpoint requires a live session, but not a fresh one; native
  behavior follows that endpoint even though the settings UI disables stale-session actions.
- The software authenticator sends the installed client's response shape, including the
  omission of `clientExtensionResults`. It produces real signatures and keys. It cannot
  prove browser prompts, OS credential storage/synchronization, hardware attestation,
  or physical authenticator interoperability. Snowtime requests attestation `none`.
- Comparisons pair checked UUIDv7 passkey/session IDs and checked random session tokens.
  Options validate 32-byte challenges and the random registration user handle before
  masking them. Only new credential/session dates are masked; seeded user dates, COSE
  bytes, counters, backup metadata, supplied IDs, and response key order remain exact.
  Both fixture hosts use `CLIENT_IP_HEADER=x-bench-ip`; IP and user-agent fields remain
  exact. Without a configured trusted header, the native host retains its existing
  unknown-address policy.
- Changed-file lint and Knip pass. Full `tsc --noEmit` has the same existing optional
  benchmark dependency and shared-props AST errors as step 1, with no changed-file errors.

Handler rows are in `native/bench/lines.ts`. The shared options rule is counted on
registration's row; authentication options reuse it.

| Handler or helper                       | TypeScript | Rust |
| --------------------------------------- | ---------: | ---: |
| Registration options and shared options |        124 |  112 |
| Authentication options                  |         95 |    0 |
| Registration                            |        112 |  125 |
| Authentication and session creation     |         86 |  127 |
| Listing                                 |         33 |    3 |
| Removal                                 |         34 |   17 |
| Ordered Zod validation                  |         11 |   66 |
| HTTP and session policy                 |         28 |   84 |

Run from the worktree root:

```sh
cargo fmt --all --manifest-path native/Cargo.toml
cargo clippy --manifest-path native/Cargo.toml --workspace --all-targets --offline -- -D warnings
cargo clippy --manifest-path native/Cargo.toml --workspace --all-targets --features bench --offline -- -D warnings
cargo test --manifest-path native/Cargo.toml -p snowtime-server --offline
cargo test --manifest-path native/Cargo.toml -p snowtime-server --features bench --offline
cargo test --manifest-path native/Cargo.toml -p snowtime-host --offline
cargo build --manifest-path native/Cargo.toml -p snowtime-host --offline
bun native/bench/conformance.ts native/target/debug/snowtime-axum conformance/passkeys.conformance.ts conformance/invitations.conformance.ts conformance/session.conformance.ts conformance/teams.conformance.ts
bun test ./conformance/passkeys.conformance.ts
bun native/bench/compare.ts native/target/debug/snowtime-axum
bun native/bench/passkey-compare.ts native/target/debug/snowtime-axum
bun native/bench/lines.ts
```

The focused passkey comparison runs the same cases that `compare.ts` includes, for
iteration without rerunning other domains. Run TypeScript conformance and comparison
sequentially: their builds replace the same harness cache. The final `*-client-shape.log`
outputs check the response shape with `clientExtensionResults` omitted. No Docker,
load, or stress runs.

Kait reviewed and approved step 2 on 2026-10-08. Manual registration, sign-in, and removal
passed with a macOS fingerprint passkey on separate accounts on both hosts.

### Step 3

Verified on macOS arm64 on 2026-10-08. Kait approved passkeys and asked to stop after
Google/OAuth. The app's Google, GitHub, and Microsoft redirect flows and account management
are ported. Step 4 remains pending. No TypeScript authentication behavior changes.

Read `better-auth.server.ts`, `sign-in.server.ts`, login-domain and name hooks, the client's
sign-in/settings calls, and the installed Better Auth 1.7.7 social sign-in, callback,
state, account, and provider sources before porting. The spike's OAuth tests demonstrate
storage compatibility; the published Rust alpha remains unmounted because this port needs
the installed TypeScript library's state-cookie binding, refusals, and account policies.
`reqwest =0.12.28`, already present in the spike dependency graph, supplies async HTTPS
with Rustls. No new schema, migration, provider configuration variable, or TypeScript
provider override is needed for production.

Behavior:

- Social sign-in and linking create a random 32-character state, a 128-character PKCE
  verifier, a signed five-minute state cookie, and a ten-minute verification row.
  Internal state fields override client `additionalData`. Authorization URL parameter
  order, default scopes, additional scopes, login hints, and callback URLs follow Better Auth.
- Callbacks bind the persisted state to the signed cookie and consume valid state before
  exchanging the code. Missing/forged cookies leave the pending flow available. Expiry,
  provider denial, missing code, and exchange failure follow Better Auth's redirects.
  JSON and form POST callbacks redirect to the GET callback, with query values taking priority.
- Provider HTTP calls run after releasing database admission and before reacquiring the
  writer for account/session changes. Requests have a 15-second timeout. Google and
  Microsoft token exchanges refuse redirects; GitHub follows the installed provider's
  fetch behavior, with the same 20-redirect bound. Google and Microsoft profiles follow the token endpoint's ID token;
  GitHub reads its profile and verified email list. Microsoft's app-specific verification
  claims include consumer accounts and `xms_edov`.
- Verified existing email addresses link implicitly without changing profile or organization
  roles. Unverified local accounts refuse implicit linking. Explicit linking requires a live
  session, matching email, and a verified provider address; existing links merge scopes.
  Sign-in refreshes tokens without replacing stored scopes. Listing hides tokens; removal
  requires a fresh session and refuses the last account, following Better Auth even when
  the user has a passkey. Sessions use the native-compatible signed session cookie.
- The app uses redirect OAuth. Better Auth's direct `idToken` sign-in/linking mode remains
  outside this port; native refuses direct tokens. Other unused Better Auth endpoints also
  remain outside the audited client-call scope.

The local fake provider is shared by both test hosts. TypeScript's preload redirects only
known providers' outbound fetches to it; native's transport override exists only with the
`bench` feature and requires loopback HTTP. Production authorization URLs and provider
configuration stay unchanged. The fake validates client credentials, callback binding,
single-use codes, and S256 PKCE on real HTTP token requests. It returns synthetic profiles
and ID tokens; these tests cannot prove live consent screens, registered redirect URLs,
provider-issued claims/signatures, TLS interoperability, or actual Google/GitHub/Microsoft
account policy. They make no claim of direct ID-token verification.

Checks and outputs are in [auth-port/step3](auth-port/step3/):

- Formatting and workspace Clippy with all targets and warnings denied pass, without
  and with `bench`.
- Server tests: 72 pass without `bench`, and 72 with it. Host tests: 17 pass.
- Native OAuth, passkey, invitation, session, and team conformance: 19 pass, 275 assertions.
  TypeScript OAuth conformance: 1 pass, 97 assertions.
- Comparison: all 1,180 calls answer with the same bytes, including 109 OAuth calls.
  Cases cover the three providers, sign-up and repeat sign-in, implicit and explicit linking,
  profile/membership preservation, scope merging, listing/removal, ordered schemas, callback
  POST forms, state/cookie tampering and replay, expired state, stale sessions, imported
  accounts, login-domain rules, Microsoft verified-address claims, and token redirect policy.
- Changed-file lint and all three Knip configurations pass. Full `tsc --noEmit` retains
  the existing optional benchmark dependency and shared-props AST errors, with no errors
  in changed files.

Run from the worktree root, sequentially for the TypeScript harness builds:

```sh
cargo fmt --all --manifest-path native/Cargo.toml
cargo clippy --manifest-path native/Cargo.toml --workspace --all-targets --offline -- -D warnings
cargo clippy --manifest-path native/Cargo.toml --workspace --all-targets --features bench --offline -- -D warnings
cargo test --manifest-path native/Cargo.toml -p snowtime-server --offline
cargo test --manifest-path native/Cargo.toml -p snowtime-server --features bench --offline
cargo test --manifest-path native/Cargo.toml -p snowtime-host --offline
cargo build --manifest-path native/Cargo.toml -p snowtime-host --features bench --offline
bun native/bench/conformance.ts native/target/debug/snowtime-axum conformance/oauth.conformance.ts conformance/passkeys.conformance.ts conformance/invitations.conformance.ts conformance/session.conformance.ts conformance/teams.conformance.ts
bun test ./conformance/oauth.conformance.ts
bun native/bench/compare.ts native/target/debug/snowtime-axum
bun native/bench/oauth-compare.ts native/target/debug/snowtime-axum
bun native/bench/lines.ts
```

The focused OAuth comparison uses the same flow and fixture checks included in `compare.ts`.
Its imported-account, expired-state, stale-session, and login-domain cases run on fresh
independent database copies and fresh hosts. Comparisons retain body bytes and redirect
locations without reserializing JSON. They mask checked random state/PKCE/code values,
paired UUIDv7 IDs, new account dates, the new session clock, and host origins. Seeded dates,
profile names, email addresses, roles, scopes, and response field order remain exact.
State cookies are checked for their signature, binding, and max age; successful callbacks
must yield a session usable through `/api/v1/session`. No Docker, load, or stress runs.

Handler rows are in `native/bench/lines.ts`; shared implementation is counted once on the
first row that uses it. The account-link entry shares the authorization rule, and all three
providers share the native profile rule.

| Handler or helper                      | TypeScript | Rust |
| -------------------------------------- | ---------: | ---: |
| OAuth sign-in and shared authorization |        123 |  191 |
| OAuth account-link entry               |        185 |    0 |
| OAuth state                            |         94 |   86 |
| OAuth callback and account writes      |        188 |  218 |
| OAuth account-link/sign-in helpers     |        367 |    0 |
| OAuth token exchange                   |         66 |   63 |
| OAuth Google profile                   |         87 |  118 |
| OAuth GitHub profile                   |         84 |    0 |
| OAuth Microsoft profile                |        135 |    0 |
| OAuth account list                     |         58 |    7 |
| OAuth unlink                           |         23 |   26 |
| OAuth ordered Zod validation           |         98 |  234 |
| OAuth HTTP and redirects               |          6 |  174 |

### Step 4

Verified on macOS arm64 on 2026-10-08. Kait approved the missing-route list and asked to
stop after step 4. All eight remaining client calls are ported. The native leave route
also supports the requested malformed-body comparison and shares member-removal cleanup.
No schema or migration changes.

Read the client's profile and organization calls, Snowtime's name, login-domain, and
member-removal hooks, and installed Better Auth 1.7.7 organization routes, adapter,
permissions, and profile update before porting. Names keep their supplied whitespace after
the hooks validate trimmed length. Slugs stay immutable. Permission, owner safeguards,
organization caps, active-organization changes, duplicate roles, response field order,
and metadata encoding follow TypeScript. At step 4, an update with no recognized organization fields retained TypeScript's empty
HTTP 500 response. [Task 081.29](29-hardening.md) corrects both backends to return 400.

Kait requested an isolated TypeScript bug fix for `memberRemovalHook`: act only when the
returned member or leave result has string `userId` and `organizationId` fields. Better
Auth can pass validation responses to this hook as objects rather than `APIError`s.
The old hook sent undefined IDs to SQL and turned malformed removal bodies into empty
HTTP 500s. The fix is `b8d93c8`, with a regression for signed-in and signed-out
malformed bodies on both removal paths. It contains no native code or architecture change
and can be applied separately to `main`.

Member removal and leaving stop only the removed user's live timer in that organization,
with the source's minimum 1 ms duration and maximum entry length. Entries remain readable
by an administrator. Team cleanup removes that organization's memberships, including lead
roles, and decrements each affected team's member count. Timers and memberships elsewhere
remain intact. The hook runs after the organization membership is deleted, as in TypeScript.

The step 3 review fix preserves the raw percent-encoded callback path and writes Fetch's
Latin-1 header bytes. TypeScript and native both return 302 for
`POST /api/auth/callback/%0A`, with `Location: <origin>/api/auth/callback/%0A?`, and for
`callbackURL: "/ä"`, with `Location: /ä`. A character outside ByteString, such as `雪`,
returned TypeScript's empty HTTP 500 without a Rust panic at step 4.
[Task 081.29](29-hardening.md) encodes that callback URL on both backends and verifies
a 302 with `Location: /%E9%9B%AA`. Rust response tests, HTTP conformance, and
`compare.ts` include these cases. The auth `expect()`/`unwrap()` audit
found no other unguarded request-derived value: ordered schemas guard body conversions,
explicit checks guard sessions and callback codes, and remaining assertions concern
serialization, fixed patterns, configuration, or database invariants. The saved grep
includes test assertions separately from the production findings described here.

Checks and outputs are in [auth-port/step4](auth-port/step4/):

- Formatting and workspace Clippy, all targets with warnings denied, pass without and
  with `bench`. Server tests: 75 pass in each configuration. Host tests: 17 pass.
- Native OAuth, passkey, invitation, session, and team conformance: 19 pass, 280 assertions.
  Auth write conformance runs on a fresh host: 1 pass, 137 assertions. TypeScript OAuth and
  auth write conformance: 2 pass, 239 assertions. TypeScript auth regression tests:
  30 pass, 135 assertions.
- Comparison: 1,346 calls are byte-equal, including 114 OAuth calls and 161 auth
  write calls. The latter cover all eight audited routes and leaving, with malformed
  removal and leave bodies, owner/admin/member permissions, immutable slugs, names,
  organization caps, invitation cancellation, active organization, retained stopped entries,
  and team cleanup. Imported sessions cover stale, expired, and blocked-domain cases on
  fresh independent copies. These checks use the development fixture hosts.
- Only checked generated UUIDv7 IDs and advancing timestamps are masked in the new write
  sequence. Seeded IDs and dates, supplied timer IDs, names, roles, metadata, refusal bodies,
  and response key order remain exact. The callback comparison retains redirect headers.
- Changed-file lint and all three Knip configurations pass. The saved `tsc --noEmit`
  output includes two fake-provider inference errors introduced by this task. The step 4
  review fix adds an explicit request-handler return type to resolve both. The remaining
  type errors concern optional benchmark dependencies and shared-props AST types.

Run from the worktree root, sequentially for TypeScript harness builds:

```sh
cargo fmt --all --manifest-path native/Cargo.toml
cargo clippy --manifest-path native/Cargo.toml --workspace --all-targets --offline -- -D warnings
cargo clippy --manifest-path native/Cargo.toml --workspace --all-targets --features bench --offline -- -D warnings
cargo test --manifest-path native/Cargo.toml -p snowtime-server --offline
cargo test --manifest-path native/Cargo.toml -p snowtime-server --features bench --offline
cargo test --manifest-path native/Cargo.toml -p snowtime-host --offline
cargo build --manifest-path native/Cargo.toml -p snowtime-host --features bench --offline
bun native/bench/conformance.ts native/target/debug/snowtime-axum conformance/oauth.conformance.ts conformance/passkeys.conformance.ts conformance/invitations.conformance.ts conformance/session.conformance.ts conformance/teams.conformance.ts
bun native/bench/conformance.ts native/target/debug/snowtime-axum conformance/auth-writes.conformance.ts
bun test ./conformance/oauth.conformance.ts
bun test ./conformance/auth-writes.conformance.ts
bun test src/server/auth/team-invitations.test.ts src/server/auth/invitations.test.ts src/server/auth/auth.schemas.test.ts src/server/auth/login-policy.test.ts
bun native/bench/compare.ts native/target/debug/snowtime-axum
bun native/bench/auth-writes-compare.ts native/target/debug/snowtime-axum
bun native/bench/lines.ts
```

The full required Rust and HTTP verification ran before each commit. The first run is
saved under `removal-fix-verification/`; top-level logs record the final native run.
Handler rows are in `native/bench/lines.ts`. No Docker, load, or stress runs; no push,
rebase, or merge. Work stops after step 4.

The review fix repeats the full required Rust and HTTP verification, with the same test
counts and 1,346 byte-equal comparisons. Outputs are in
[review-fix-verification](auth-port/step4/review-fix-verification/), including the type check
that confirms both fake-provider errors are resolved.

## Follow-up

Completed in [081.29](29-hardening.md): TCP peer addresses in direct mode, trusted-proxy
headers, Better Auth per-IP quotas through `tower_governor`, the shared `RATE_LIMIT`
switch, and production-mode refusal checks. TLS and ACME remain opt-in.

## Local review

The worktree's independent review copies are already prepared at
`perf/.cache/auth-review-ts.db` and `perf/.cache/auth-review-native.db`. On a fresh checkout,
prepare them once with `bun native/bench/prepare-auth-review.ts`. The script refuses to
replace an existing copy. It adds two 48-hour pending invitations to each seeded copy:
Noah joins Lumen Works and its Design team; Kristiina already belongs to Lumen Works as
owner and accepts a member invitation without losing her role.

Build the frontend and render bundle if needed:

```sh
bun run i18n:compile
bun run build
bun native/crates/render/bundle/build.ts
cargo build --manifest-path native/Cargo.toml -p snowtime-host --offline
```

In one terminal:

```sh
cd /private/tmp/snowtime-081-auth-port
NODE_ENV=development HOST=127.0.0.1 PORT=3100 \
  BETTER_AUTH_SECRET=localhost-review-secret-081-auth-port \
  BETTER_AUTH_URL=http://localhost:3100 \
  TURSO_DATABASE_URL=file:/private/tmp/snowtime-081-auth-port/perf/.cache/auth-review-ts.db \
  bun .output/server/index.mjs
```

In another:

```sh
cd /private/tmp/snowtime-081-auth-port
NODE_ENV=development HOST=127.0.0.1 PORT=3200 RENDERERS=1 \
  BETTER_AUTH_SECRET=localhost-review-secret-081-auth-port \
  BETTER_AUTH_URL=http://127.0.0.1:3200 \
  TURSO_DATABASE_URL=file:/private/tmp/snowtime-081-auth-port/perf/.cache/auth-review-native.db \
  EDGE_STATIC_DIR=native/crates/render/bundle/dist/public \
  native/target/debug/snowtime-axum
```

Open the same path on `http://localhost:3100` and `http://127.0.0.1:3200`:

- `/invitation/01900000-0000-7000-8031-000000000001`: sign in as `noah@example.com`.
- `/invitation/01900000-0000-7000-8031-000000000002`: sign in as
  `kristiina@lumen.example.com`.

Both use password `snowtime-local`. Different hostnames keep cookies separate.
Accept each link, reload the organization view to check the membership and Design team,
and reopen the invitation to check that it is closed. The native invitation page's `organization/set-active` call is now ported in step 4.

## Passkey review

Use the two seeded database copies above. For a browser passkey check, use `localhost`
for both hosts, with separate browser profiles to keep their cookies apart. Stop the
acceptance-review native host and restart it with its URL changed to `localhost`:

```sh
cd /private/tmp/snowtime-081-auth-port
NODE_ENV=development HOST=127.0.0.1 PORT=3200 RENDERERS=1 \
  BETTER_AUTH_SECRET=localhost-review-secret-081-auth-port \
  BETTER_AUTH_URL=http://localhost:3200 \
  TURSO_DATABASE_URL=file:/private/tmp/snowtime-081-auth-port/perf/.cache/auth-review-native.db \
  EDGE_STATIC_DIR=native/crates/render/bundle/dist/public \
  native/target/debug/snowtime-axum
```

On `http://localhost:3100`, sign in as `kristiina@lumen.example.com` with password
`snowtime-local`. On `http://localhost:3200`, use another browser profile and
`noah@example.com` with the same password, so the authenticator's account labels differ.
Open Settings and add a passkey on each host. Sign out, choose the passkey registered
for that host's database, then return to Settings and remove it. Reopen Settings to
check that the row is gone. Both hosts share the `localhost` relying party; their
databases and sessions remain separate.

The OAuth account-list endpoint used by Settings is also ported in step 3.
