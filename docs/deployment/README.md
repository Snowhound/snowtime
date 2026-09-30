# Deployment

## Register the OAuth apps

Production has no password sign-in, and a passkey can only be added to an existing
account, so at least one OAuth provider must be configured or nobody can sign in. Each
provider redirects to `https://<host>/api/auth/callback/<id>`.

| Provider  | Where                                                 | Redirect URL                                 |
| --------- | ----------------------------------------------------- | -------------------------------------------- |
| GitHub    | GitHub, Settings > Developer settings > OAuth Apps    | `https://<host>/api/auth/callback/github`    |
| Google    | Google Cloud console, APIs & Services > Credentials   | `https://<host>/api/auth/callback/google`    |
| Microsoft | Microsoft Entra admin center, App registrations (Web) | `https://<host>/api/auth/callback/microsoft` |

For GitHub, create an **OAuth App**, not a GitHub App: the GitHub App form asks for a
webhook URL and permissions, which sign-in doesn't use. In the OAuth App form:

- Homepage URL: `https://<host>`.
- Redirect URIs: `https://<host>/api/auth/callback/github`. The form takes up to 10, so
  one app can also list `http://localhost:3000/api/auth/callback/github` for local
  development.
- Leave **Allow wildcard matching** and **Enable Device Flow** off. **Expire user access
  tokens** can stay on: the app uses GitHub's token only at sign-in and then keeps its
  own session.

Google and Microsoft also list several redirect URLs in one app. For Microsoft account
types and `MICROSOFT_TENANT_ID`, see `architecture.md` ("Sign-in methods").

For Microsoft, also add the `xms_edov` optional claim, which says the account's tenant has
verified its email domain. In the app registration, open **Token configuration**, choose
**Add optional claim**, pick the **ID** token type, and select `xms_edov`. Without it, the
app refuses work and school accounts at sign-up, because Microsoft doesn't otherwise say
their address is verified; personal Microsoft accounts sign up either way. See
`architecture.md` ("Sign-in methods").

Google publishes an External app only with a privacy policy link. Under **Google Auth
Platform > Branding**, enter `https://<host>/privacy` and `https://<host>/terms`, and add
the host's domain under **Authorized domains**. Both pages name Snowhound OÜ as the
operator, so a stack someone else runs changes `COMPANY` in
`src/features/legal/legal-layout.tsx` and the documents' text first.

Copy each provider's client ID and secret. GitHub shows a client secret only once, right
after you generate it.

## Changing the host later

Moving from `<project>.vercel.app` to your own domain, for example, takes a few minutes:

1. Add the new domain in Vercel and wait for its certificate.
2. Add the new host's redirect URL to each OAuth app. GitHub, Google, and Microsoft all
   take several, so you can remove the old one once the move works.
3. Set `BETTER_AUTH_URL` to the new host and redeploy.

OAuth accounts and all data carry over. Passkeys don't: a passkey is bound to the host it
was registered on, so users add theirs again on the new host.
