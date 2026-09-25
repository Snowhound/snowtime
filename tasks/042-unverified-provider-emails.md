# 042: Unverified provider emails

Status: todo

Better Auth creates a user with whatever email the sign-in provider returns and records
whether the provider verified it (`user.email_verified`). Task 039 found two problems
with that on 2026-09-25, both read from the Better Auth 1.7.6 source. Neither was
reproduced, because no Microsoft or GitHub sign-in is configured locally.

- Invitations: accepting one requires a verified email
  (`requireEmailVerificationOnInvitation`), and the app sends no verification email.
  Microsoft reports an email as verified only through the optional `email_verified`,
  `verified_primary_email`, or `verified_secondary_email` claims, and otherwise stores
  `false` (`@better-auth/core/dist/social-providers/microsoft-entra-id.mjs`). GitHub
  stores `false` when its `/user/emails` list doesn't mark the address verified. Such a
  user gets `EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION` and
  can never join an organization. `docs/architecture.md` ("Sign-in methods") assumes the
  providers supply a verified address.
- Lockout: with Microsoft's default `common` tenant, anyone can sign in from a tenant
  they control, whose accounts can claim any address. The first such sign-in creates an
  unverified user with, for example, `victim@corp.com`. When the real owner later signs in
  with a provider that verified the address, Better Auth refuses to link to the
  unverified user (`requireLocalEmailVerified`), so the owner can't sign in with that
  address at all.

## Acceptance criteria

- [ ] A Microsoft sign-in, and a GitHub one, is tested in an environment with the
      provider configured, and the stored `email_verified` is recorded here
- [ ] Microsoft users can accept invitations: through optional claims in the Entra app
      registration, a check of Microsoft's verified-domain claim (`xms_edov`), or
      another rule that doesn't trust an address the tenant made up
- [ ] An unverified provider email can't block a later verified sign-in with the same
      address. For example, a `databaseHooks.user.create.before` hook refuses social
      sign-ups whose email isn't verified, with a message on the sign-in screen
- [ ] `docs/architecture.md` ("Sign-in methods") and `docs/deployment.md` (the Microsoft
      app setup) say which providers give verified addresses and what the app does with
      the others
