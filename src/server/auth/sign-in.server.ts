// Which sign-in methods an environment offers. Pure, so better-auth.server.ts and getSignInMethods
// build from the same rule and cannot disagree about what is configured. Also which provider
// addresses count as verified (docs/architecture/auth.md, "Sign-in methods").
import { APIError } from 'better-auth/api'

export type SignInMethod = 'google' | 'github' | 'microsoft' | 'password' | 'passkey'

export type SignInConfig = {
  NODE_ENV: 'development' | 'test' | 'production'
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  MICROSOFT_CLIENT_ID?: string
  MICROSOFT_CLIENT_SECRET?: string
  MICROSOFT_TENANT_ID?: string
}

// Better Auth's socialProviders option: a provider is enabled when its client ID and secret
// are both set. src/env.ts rejects a half-set pair at startup.
export function socialProviders(config: SignInConfig) {
  return {
    ...(config.GOOGLE_CLIENT_ID &&
      config.GOOGLE_CLIENT_SECRET && {
        google: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET },
      }),
    ...(config.GITHUB_CLIENT_ID &&
      config.GITHUB_CLIENT_SECRET && {
        github: { clientId: config.GITHUB_CLIENT_ID, clientSecret: config.GITHUB_CLIENT_SECRET },
      }),
    ...(config.MICROSOFT_CLIENT_ID &&
      config.MICROSOFT_CLIENT_SECRET && {
        microsoft: {
          clientId: config.MICROSOFT_CLIENT_ID,
          clientSecret: config.MICROSOFT_CLIENT_SECRET,
          // Unset means Better Auth's default, `common`: any work, school or personal account.
          ...(config.MICROSOFT_TENANT_ID && { tenantId: config.MICROSOFT_TENANT_ID }),
          mapProfileToUser: (profile: MicrosoftClaims) => ({
            emailVerified: microsoftEmailVerified(profile),
          }),
        },
      }),
  }
}

// Password sign-in is for local development with seeded users only (docs/architecture/auth.md,
// "Sign-in methods").
export function passwordEnabled(config: SignInConfig) {
  return config.NODE_ENV === 'development'
}

// The methods the sign-in view shows, in display order. Ids only: the client owns the
// labels, and nothing here may carry a secret.
export function signInMethods(config: SignInConfig): SignInMethod[] {
  const providers = socialProviders(config)
  const methods: SignInMethod[] = []
  if (providers.google) methods.push('google')
  if (providers.github) methods.push('github')
  if (providers.microsoft) methods.push('microsoft')
  if (passwordEnabled(config)) methods.push('password')
  methods.push('passkey')
  return methods
}

// Every personal Microsoft account signs in through this tenant, which Microsoft runs.
const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'

// The ID token claims that tell whether Microsoft vouches for the address.
export interface MicrosoftClaims {
  email?: string
  tid?: string
  email_verified?: boolean
  verified_primary_email?: string[]
  verified_secondary_email?: string[]
  // The tenant has verified the address's domain. An optional claim, which the Entra app
  // registration must add to the ID token (docs/deployment/README.md).
  xms_edov?: boolean
}

// Better Auth trusts only the email_verified and verified_*_email claims, which Microsoft
// sends only when the app registration asks for them. A personal account's address is one
// Microsoft verified, and xms_edov says the tenant owns the domain. Any other work address is
// one the tenant typed in, so it stays unverified.
export function microsoftEmailVerified(claims: MicrosoftClaims): boolean {
  const listed =
    !!claims.email &&
    [...(claims.verified_primary_email ?? []), ...(claims.verified_secondary_email ?? [])].includes(
      claims.email,
    )
  return (
    claims.email_verified === true ||
    listed ||
    claims.tid === MICROSOFT_CONSUMER_TENANT ||
    claims.xms_edov === true
  )
}

// Better Auth's password sign-up, which only development offers (passwordEnabled).
const PASSWORD_SIGN_UP = '/sign-up/email'

const signUpRefusals = {
  EMAIL_UNVERIFIED: "The sign-in provider hasn't verified this account's email address.",
} as const

// A databaseHooks.user.create.before hook. A provider sign-up needs a verified address: an
// unverified user would hold the address, and Better Auth refuses to link a later, verified
// sign-in to it, so the address's owner could never sign in. Better Auth sends the code to
// the sign-in page's `error` search parameter.
export async function refuseUnverifiedSignUp(
  user: { emailVerified?: boolean | null },
  ctx?: { path?: string } | null,
) {
  if (user.emailVerified || ctx?.path === PASSWORD_SIGN_UP) return
  throw new APIError('FORBIDDEN', {
    code: 'EMAIL_UNVERIFIED',
    message: signUpRefusals.EMAIL_UNVERIFIED,
  })
}
