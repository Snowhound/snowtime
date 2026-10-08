import { APIError } from 'better-auth/api'
import { and, count, eq, gt } from 'drizzle-orm'
import type { Database } from '~/db'
import { invitation } from '~/db/schema'
import { limits } from '../limits.server'

export function invitationLimit(db: Database) {
  return async ({ organization }: { organization: { id: string } }) => {
    const [row] = await db
      .select({ count: count() })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, organization.id),
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, new Date()),
        ),
      )
    // Better Auth caps its fetched rows before filtering expired invitations.
    if (row.count >= limits.pendingInvitationsPerOrganization)
      throw new APIError('FORBIDDEN', {
        code: 'INVITATION_LIMIT_REACHED',
        message: 'Invitation limit reached',
      })
    return limits.pendingInvitationsPerOrganization
  }
}
