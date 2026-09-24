// What an invitation link shows before anyone signs in. Better Auth's get-invitation needs
// the invited user's session, but the invitation screen names the organization, team,
// inviter, and invited address to whoever opens the link, so they know which account to
// sign in with. The link's id is the only secret, as in Better Auth; accepting still goes
// through Better Auth, which checks the address.
import { eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Database } from '~/db'
import { invitation, organization, team, user } from '~/db/schema'
import { strongestRole } from '../scope.server'

export type InvitationState = 'pending' | 'expired' | 'closed'

export async function invitationPreview(db: Database, id: string, now = new Date()) {
  const inviter = alias(user, 'inviter')
  const [row] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      teamName: team.name,
      inviterName: inviter.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(inviter, eq(inviter.id, invitation.inviterId))
    .leftJoin(team, eq(team.id, invitation.teamId))
    .where(eq(invitation.id, id))
  if (!row) return null

  // Accepted, rejected, and canceled invitations are closed; the screen only says so.
  const state: InvitationState =
    row.status !== 'pending' ? 'closed' : row.expiresAt <= now ? 'expired' : 'pending'
  return {
    id: row.id,
    email: row.email,
    role: strongestRole(row.role ?? 'member'),
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    teamName: row.teamName,
    inviterName: row.inviterName,
    state,
  }
}
