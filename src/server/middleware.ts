// Server-function middleware. Every server function uses one of these:
// - sessionMiddleware: a signed-in user, for calls that are not tied to an organization
//   (the running timer spans organizations). Adds context.userId.
// - scopeMiddleware: the tenancy scope of the active organization. Adds context.scope.
// Both run the rest of the call inside withActor(userId), so writes record the user in
// created_by/updated_by, and both count a POST call against the user's write rate.
import { createMiddleware } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { db } from '~/db'
import { withActor } from '~/db/actor'
import { auth, rateLimitStore } from './auth/better-auth.server'
import { AppError } from './errors'
import { rateLimits } from './limits.server'
import { resolveScope } from './scope.server'

export const sessionMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next, method }) => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) {
      throw new AppError('UNAUTHENTICATED', 'sign_in_required')
    }
    const { userId, activeOrganizationId } = session.session
    // Every write is a POST, so this covers write server functions added later too.
    if (method === 'POST') {
      const { allowed } = await rateLimitStore.consume(`write:${userId}`, rateLimits.writesPerUser)
      if (!allowed) throw new AppError('RATE_LIMITED', 'rate_limited')
    }
    return withActor(userId, () =>
      next({ context: { userId, activeOrganizationId: activeOrganizationId ?? null } }),
    )
  },
)

export const scopeMiddleware = createMiddleware({ type: 'function' })
  .middleware([sessionMiddleware])
  .server(async ({ next, context }) => {
    const scope = await resolveScope(db, context.userId, context.activeOrganizationId)
    return next({ context: { scope } })
  })
