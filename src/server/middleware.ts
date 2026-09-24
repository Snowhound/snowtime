// Server-function middleware. Every server function uses one of these:
// - sessionMiddleware: a signed-in user, for calls that are not tied to an organization
//   (the running timer spans organizations). Adds context.userId.
// - scopeMiddleware: the tenancy scope of the active organization. Adds context.scope.
// Both run the rest of the call inside withActor(userId), so writes record the user in
// created_by/updated_by.
import { createMiddleware } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { db } from '../db'
import { withActor } from '../db/actor'
import { auth } from '../lib/auth'
import { AppError } from './errors'
import { resolveScope } from './scope.server'

export const sessionMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) {
      throw new AppError('UNAUTHENTICATED', 'sign_in_required')
    }
    const { userId, activeOrganizationId } = session.session
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
