# 016: Email delivery

Status: todo (later, optional)

The MVP sends no email (`docs/architecture.md`, "Sign-in methods"). Add Brevo when
email invitations, password sign-in outside development, or notifications are wanted.
Email stays optional per deployment.

## Acceptance criteria

- [ ] One small sender module calls Brevo's transactional email HTTP API with `fetch`;
      no SDK
- [ ] Optional env vars (`BREVO_API_KEY`, `EMAIL_FROM`) in `src/env.ts`; without them the
      app behaves as the MVP does (no email, invitation links shared by admins)
- [ ] Better Auth wired: `sendInvitationEmail` (the invitation URL is built by the app),
      and `sendVerificationEmail` and `sendResetPassword` if password sign-in is enabled
      outside development
- [ ] Plain, text-first templates; no template engine
- [ ] Sending domain verified (SPF, DKIM) for the production sender
- [ ] `docs/architecture.md` updated; env vars added to the Vercel projects (task 009)
