import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { APIError } from 'better-auth/api'
import { db } from '~/db'
import { AppError } from '../errors'
import { rateLimits } from '../limits.server'
import { scopeMiddleware, sessionMiddleware } from '../middleware'
import { GetInvitationInput, InviteMemberInput } from './auth.schemas'
import { auth, rateLimitStore } from './better-auth.server'
import * as invitations from './invitations.server'

// Preserve Better Auth's refusal codes for the same translated messages as client calls.
async function authResult<T>(call: () => Promise<T>) {
  try {
    return { data: await call(), error: null }
  } catch (error) {
    if (error instanceof APIError)
      return { data: null, error: { code: error.body?.code, status: error.statusCode } }
    throw error
  }
}

export const listInvitations = createServerFn({ method: 'GET' })
  .middleware([scopeMiddleware])
  .handler(({ context }) => invitations.listInvitations(db, context.scope))

export const inviteMember = createServerFn({ method: 'POST' })
  .middleware([scopeMiddleware])
  .validator(InviteMemberInput)
  .handler(async ({ data, context }) => {
    const { allowed } = await rateLimitStore.consume(
      `invite:${context.scope.userId}`,
      rateLimits.inviteMember,
    )
    if (!allowed) throw new AppError('RATE_LIMITED', 'rate_limited')
    return authResult(() =>
      invitations.inviteMember(db, context.scope, data, () =>
        auth.api.createInvitation({
          headers: getRequestHeaders(),
          body: {
            email: data.email,
            role: data.role,
            organizationId: context.scope.organizationId,
          },
        }),
      ),
    )
  })

export const acceptInvitation = createServerFn({ method: 'POST' })
  .middleware([sessionMiddleware])
  .validator(GetInvitationInput)
  .handler(({ data, context }) =>
    authResult(() =>
      invitations.acceptInvitation(db, context.userId, data.id, () =>
        auth.api.acceptInvitation({
          headers: getRequestHeaders(),
          body: { invitationId: data.id },
        }),
      ),
    ),
  )
