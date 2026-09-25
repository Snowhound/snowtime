// Server-function middleware. Every server function uses one of these:
// - sessionMiddleware: a signed-in user, for calls that are not tied to an organization
//   (the running timer spans organizations). Adds context.userId.
// - scopeMiddleware: the tenancy scope of the active organization. Adds context.scope. The
//   client sends the organization its tab shows, and a call for another is refused
//   (resolveSessionScope), since tabs share the session's organization.
// Both run the rest of the call inside withActor(userId), so writes record the user in
// created_by/updated_by, and both count a POST call against the user's write rate.
import { createMiddleware, getRouterInstance } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { db } from '~/db'
import { withActor } from '~/db/actor'
import { callInShownOrganization } from '~/lib/session'
import { auth, rateLimitStore } from './auth/better-auth.server'
import { AppError } from './errors'
import { rateLimits } from './limits.server'
import { resolveSessionScope } from './scope.server'

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
  // The organization the caller's cache shows: in the browser the tab's, during server
  // rendering the page's.
  .client(async ({ next }) => {
    const { queryClient } = (await getRouterInstance()).options.context
    return callInShownOrganization(queryClient, (shownOrganizationId) =>
      next({ sendContext: { shownOrganizationId } }),
    )
  })
  .server(async ({ next, context }) => {
    // Sent by the client, so checked like any input.
    const shown = context.shownOrganizationId
    const scope = await resolveSessionScope(
      db,
      context.userId,
      context.activeOrganizationId,
      async () => {
        const session = await auth.api.getSession({
          headers: getRequestHeaders(),
          query: { disableCookieCache: true },
        })
        return session?.session.userId === context.userId
          ? session.session.activeOrganizationId
          : null
      },
      typeof shown === 'string' ? shown : undefined,
    )
    return next({ context: { scope } })
  })
