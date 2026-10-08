import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import type { Database } from '~/db'
import { invitation, session as sessions } from '~/db/schema'
import { insertTeamMember } from '../teams/teams.server'

// Better Auth inserts unconditionally. A recipient may have joined since the link was sent.
export function invitationAcceptanceHooks(db: Database) {
  return {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/organization/accept-invitation') return undefined
      const id = ctx.body?.invitationId
      if (typeof id !== 'string') return undefined
      const session = await getSessionFromCtx(ctx)
      if (!session) return undefined
      const found = await db.query.invitation.findFirst({ where: { id } })
      if (!found || found.status !== 'pending' || found.expiresAt < new Date()) return undefined
      if (found.email.toLowerCase() !== session.user.email.toLowerCase()) return undefined
      if (!session.user.emailVerified) return undefined
      const existing = await db.query.member.findFirst({
        where: { organizationId: found.organizationId, userId: session.user.id },
      })
      if (!existing) return undefined
      const accepted = await db.transaction(async (tx) => {
        const [accepted] = await tx
          .update(invitation)
          .set({ status: 'accepted' })
          .where(and(eq(invitation.id, id), eq(invitation.status, 'pending')))
          .returning()
        if (!accepted)
          throw new APIError('BAD_REQUEST', {
            code: 'INVITATION_NOT_FOUND',
            message: 'Invitation not found',
          })
        await tx
          .update(sessions)
          .set({ activeOrganizationId: found.organizationId })
          .where(eq(sessions.token, session.session.token))
        if (accepted.teamId) await insertTeamMember(tx, accepted.teamId, session.user.id)
        return accepted
      })
      return ctx.json({
        invitation: {
          organizationId: accepted.organizationId,
          email: accepted.email,
          role: accepted.role,
          status: accepted.status,
          expiresAt: accepted.expiresAt,
          createdAt: accepted.createdAt,
          inviterId: accepted.inviterId,
          id: accepted.id,
        },
        member: {
          organizationId: existing.organizationId,
          userId: existing.userId,
          role: existing.role,
          createdAt: existing.createdAt,
          id: existing.id,
        },
      })
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/organization/accept-invitation') return undefined
      const result = ctx.context.returned as
        | { invitation?: { id?: string }; member?: { userId?: string } }
        | undefined
      const id = result?.invitation?.id
      const userId = result?.member?.userId
      if (!id || !userId) return undefined
      await db.transaction(async (tx) => {
        const found = await tx.query.invitation.findFirst({ where: { id, status: 'accepted' } })
        if (found?.teamId) await insertTeamMember(tx, found.teamId, userId)
      })
      return undefined
    }),
  }
}
