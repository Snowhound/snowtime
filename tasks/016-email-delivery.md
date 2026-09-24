# 016: Email delivery

Status: todo

Send verification, password-reset, and invitation emails through Resend's HTTP API,
and keep a deployment without email working. Without a sender, invitations cannot be
accepted (Better Auth requires a verified email first) and passwords cannot be reset.

## Acceptance criteria

- [ ] Decision recorded in `docs/architecture.md` (replacing the open email question):
      Resend, optional per deployment via `RESEND_API_KEY` and `EMAIL_FROM`
- [ ] One small sender module calls Resend with `fetch`; no SDK
- [ ] Without `RESEND_API_KEY`: links are logged to the server console in development;
      in any deployment, `requireEmailVerificationOnInvitation` is off and admins share
      invitation links, and password reset is unavailable
- [ ] Better Auth wired: `sendVerificationEmail`, `sendResetPassword`,
      `sendInvitationEmail` (the invitation URL is built by the app)
- [ ] Plain, text-first templates; no template engine
- [ ] Sending domain verified (SPF, DKIM) for the production sender
- [ ] Env vars added to `src/env.ts` as optional, and to the Vercel projects (task 009)
