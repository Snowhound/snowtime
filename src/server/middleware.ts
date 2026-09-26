import { createMiddleware } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { db } from '~/db'
import { withActor } from '~/db/actor'
import { auth, rateLimitStore } from './auth/better-auth.server'
import { AppError } from './errors'
import { rateLimits } from './limits.server'
import { parseOrganizationInput } from './schemas'
import { resolveScope } from './scope.server'

// A signed-in user, as context.userId. The call runs as that user (withActor), and each POST
// counts against their write rate.
export const sessionMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next, method }) => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) {
      throw new AppError('UNAUTHENTICATED', 'sign_in_required')
    }
    const { userId } = session.session
    if (method === 'POST') {
      const { allowed } = await rateLimitStore.consume(`write:${userId}`, rateLimits.writesPerUser)
      if (!allowed) throw new AppError('RATE_LIMITED', 'rate_limited')
    }
    return withActor(userId, () => next({ context: { userId } }))
  },
)

// The scope of the organization the call names, as context.scope (docs/architecture.md,
// "Tenancy"). Start merges this validator's input type into the function's, so every scoped
// call must pass `organizationId`.
export const scopeMiddleware = createMiddleware({ type: 'function' })
  .middleware([sessionMiddleware])
  // Start runs this on the raw data before the function's own schema, which then parses the
  // rest, so it checks `organizationId` and returns the input whole. A Valibot looseObject
  // would do both, but its type fails Start's check that inputs are serializable.
  .validator((input: { organizationId: string }) => parseOrganizationInput(input))
  .server(async ({ next, context, data }) =>
    next({ context: { scope: await resolveScope(db, context.userId, data.organizationId) } }),
  )
