// The app's public origin, which Better Auth, passkeys, and invitation links build on
// (docs/architecture/auth.md, "Preview deployments"). Pure, so src/env.ts can check it at
// startup and tests can call it.

export type AppUrlConfig = {
  BETTER_AUTH_URL?: string
  VERCEL_ENV?: 'production' | 'preview' | 'development'
  VERCEL_BRANCH_URL?: string
  VERCEL_URL?: string
}

// A Vercel preview gets generated hosts: a branch URL that stays across pushes, and a URL per
// deployment, which Vercel's comment on the PR links. The branch URL is the app's URL, and
// the deployment URL is trusted too so sign-in works from either.
export function appUrls(config: AppUrlConfig): { appUrl: string; trustedOrigins: string[] } {
  if (config.VERCEL_ENV === 'preview') {
    if (config.BETTER_AUTH_URL) {
      throw new Error('Leave BETTER_AUTH_URL unset on previews; VERCEL_BRANCH_URL sets it.')
    }
    if (!config.VERCEL_BRANCH_URL) {
      throw new Error('A preview needs VERCEL_BRANCH_URL; expose system environment variables.')
    }
    return {
      appUrl: `https://${config.VERCEL_BRANCH_URL}`,
      trustedOrigins: config.VERCEL_URL ? [`https://${config.VERCEL_URL}`] : [],
    }
  }
  if (!config.BETTER_AUTH_URL) throw new Error('Set BETTER_AUTH_URL to the app’s public URL.')
  return { appUrl: config.BETTER_AUTH_URL, trustedOrigins: [] }
}
