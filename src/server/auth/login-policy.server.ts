import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { loginDomainAllowed } from '~/lib/login-domains'

function requireAllowedEmail(email: string, domains: readonly string[]) {
  if (loginDomainAllowed(email, domains)) return
  throw new APIError('FORBIDDEN', {
    code: 'LOGIN_DOMAIN_NOT_ALLOWED',
    message: 'This email domain cannot sign in to this instance.',
  })
}

export function loginDomainHooks(
  domains: readonly string[],
  findUser: (id: string) => Promise<{ email: string } | null | undefined>,
) {
  return {
    user: {
      create: {
        before: async (user: { email: string }) => {
          requireAllowedEmail(user.email, domains)
        },
      },
      update: {
        before: async (user: { email?: string }) => {
          if (user.email !== undefined) requireAllowedEmail(user.email, domains)
        },
      },
    },
    session: {
      create: {
        before: async (session: { userId: string }) => {
          if (domains.length === 0) return
          const user = await findUser(session.userId)
          requireAllowedEmail(user?.email ?? '', domains)
        },
      },
    },
  }
}

export function loginDomainMiddleware(domains: readonly string[]) {
  return createAuthMiddleware(async (ctx) => {
    if (domains.length === 0 || ctx.path === '/sign-out' || ctx.path === '/get-session')
      return undefined
    const session = await getSessionFromCtx(ctx)
    if (!session || loginDomainAllowed(session.user.email, domains)) return undefined
    requireAllowedEmail(session.user.email, domains)
    return undefined
  })
}

export function loginDomainSessionAllowed(domains: readonly string[], returned: unknown): boolean {
  if (!returned || typeof returned !== 'object' || !('user' in returned)) return true
  const user = returned.user
  return (
    !user ||
    typeof user !== 'object' ||
    !('email' in user) ||
    (typeof user.email === 'string' && loginDomainAllowed(user.email, domains))
  )
}
