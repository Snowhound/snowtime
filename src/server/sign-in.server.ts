// Which sign-in methods an environment offers. Pure, so auth.ts and getSignInMethods build
// from the same rule and cannot disagree about what is configured.

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
        },
      }),
  }
}

// Password sign-in is for local development with seeded users only (docs/architecture.md,
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
