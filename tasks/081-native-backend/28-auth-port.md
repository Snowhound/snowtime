# 081.28: Complete the native auth port

Status: in-progress

Close the functional gaps so a native-only host serves every call the app makes.
TypeScript and installed Better Auth 1.7.6 remain the source of truth. Follow
[081.26](26-functional-port.md). Work on `081-auth-port`, from `081-native-poc` at
`6e8a18b`, in `/private/tmp/snowtime-081-auth-port`.

## Steps and acceptance criteria

1. Invitation acceptance:
   - [ ] Port `POST /api/v1/invitations/:id/accept` and Better Auth's
         `POST /api/auth/organization/accept-invitation`.
   - [ ] Run invitation conformance without the acceptance exclusion.
   - [ ] Compare fresh database copies, including success, optional team assignment,
         wrong recipient, expired, canceled, and already-member cases.
   - [ ] Stop after step 1. Give Kait the commit range, verification counts, and commands
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
- [ ] Centralize Rust's invitation and team caps to mirror `limits.server.ts`.
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

Pending step 1.
