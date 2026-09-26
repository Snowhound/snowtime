// Server-function middleware. Every server function uses one of these:
// - sessionMiddleware: a signed-in user, for calls that are not tied to an organization
//   (the running timer spans organizations). Adds context.userId.
// - scopeMiddleware: the tenancy scope of the organization the call names. Every
//   organization-scoped call takes `organizationId`, since each tab shows the organization
//   in its URL (docs/architecture.md, "Tenancy"). Adds context.scope.
// Both run the rest of the call inside withActor(userId), so writes record the user in
// created_by/updated_by, and both count a POST call against the user's write rate.
import { createMiddleware } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { db } from '~/db'
import { withActor } from '~/db/actor'
import { auth, rateLimitStore } from './auth/better-auth.server'
import { AppError } from './errors'
import { rateLimits } from './limits.server'
import { parseOrganizationInput } from './schemas'
import { resolveScope } from './scope.server'

export const sessionMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next, method }) => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) {
      throw new AppError('UNAUTHENTICATED', 'sign_in_required')
    }
    const { userId } = session.session
    // Every write is a POST, so this covers write server functions added later too.
    if (method === 'POST') {
      const { allowed } = await rateLimitStore.consume(`write:${userId}`, rateLimits.writesPerUser)
      if (!allowed) throw new AppError('RATE_LIMITED', 'rate_limited')
    }
    return withActor(userId, () => next({ context: { userId } }))
  },
)

// Start runs this validator on the raw call data before the function's own, and merges the
// input types, so every scoped call must name its organization. The functions' own schemas
// are plain objects, which drop `organizationId` again. A valibot looseObject would keep the
// rest of the data too, but its type fails Start's check that inputs are serializable.
export const scopeMiddleware = createMiddleware({ type: 'function' })
  .middleware([sessionMiddleware])
  .validator((input: { organizationId: string }) => parseOrganizationInput(input))
  .server(async ({ next, context, data }) =>
    next({ context: { scope: await resolveScope(db, context.userId, data.organizationId) } }),
  )
