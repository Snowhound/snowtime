# 081.28: Complete the native auth port

Status: in-progress

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
   - [ ] Port registration, sign-in, listing, and removal as the app uses them.
   - [ ] Start from [the auth spike](auth-spike.md), branch `081-auth-spike`; record
         the chosen crates and reasons. The method list already advertises passkeys.
3. Google/OAuth:
   - [ ] Match Better Auth's state, PKCE, callback, and account-linking behavior.
   - [ ] Use a local fake provider for both comparison servers; record what it cannot prove.
4. Remaining client calls:
   - [ ] Show Kait the audited missing-route list below before porting this step.
   - [ ] Port every remaining organization write and profile update in that list.

For every step:

- [ ] Read the TypeScript domain and installed Better Auth source before porting.
      Ask Kait about suspect rules. A TypeScript behavior change requires a decision
      in `docs/architecture/`; don't change it silently.
- [ ] Put routes in the domain's `routes.rs`, with one rule call per handler.
      Validate in Valibot or Zod order, with matching messages, before deserialization.
- [ ] Add byte-equal comparisons to `native/bench/compare.ts`, conformance in
      `conformance/`, and handler rows in `native/bench/lines.ts`.
- [x] Centralize Rust's invitation and team caps to mirror `limits.server.ts`.
- [ ] Before implementation commits, run `cargo fmt`; workspace Clippy
      `--all-targets -- -D warnings`, with and without `--features bench`; server tests
      with and without `bench`; host tests; affected files through
      `native/bench/conformance.ts`; and `compare.ts`.
- [ ] Record counts and save output under `auth-port/stepN/` here. Update the ported
      and not-ported list in `native/README.md` and the Open notes in subtask 01.

No Docker, load, or stress runs. Don't push, rebase, or merge without Kait's approval.

## Missing-route audit

Audit at `6e8a18b`: inspect all `src/server/*/*.routes.ts`, the Rust domain routers,
and production `authClient` calls under `src/`, including installed passkey client
subrequests. Existing email sign-in and sign-out are ported.

The only application API route without a Rust counterpart is
`POST /api/v1/invitations/:id/accept` (step 1).

All following Better Auth paths have the prefix `/api/auth` and currently return 404:

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

Verified on macOS arm64 on 2026-10-08. Step 1 is complete; steps 2–4 are pending.
Kait approved fixing the TypeScript already-member crash with the recorded option 2
in [the auth decision](../../docs/architecture/auth.md#invitation-acceptance-after-joining).
The scope commit is `2583c0c`; the isolated TypeScript fix is `1222cf2`. Applying
that fix to `main` requires Kait's review and approval.

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
and reopen the invitation to check that it is closed. The native invitation page still
calls the unported `organization/set-active` endpoint after acceptance; acceptance itself
already activates the organization, and step 4 ports that client call.
