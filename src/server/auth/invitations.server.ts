// What an invitation link shows before anyone signs in. Better Auth's get-invitation needs
// the invited user's session, but the invitation screen names the organization, team,
// inviter, and invited address to whoever opens the link, so they know which account to
// sign in with. The link's id is the only secret, as in Better Auth; accepting still goes
// through Better Auth, which checks the address. Once the invitation can't be accepted, the
// link shows less: an expired one only who to ask for a new one, a closed one nothing.
import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Database } from '~/db'
import { invitation, organization, team, user } from '~/db/schema'
import { AppError } from '../errors'
import { isAdmin, type Scope, strongestRole } from '../scope.server'
import { assertTeamInScope, insertTeamMember } from '../teams/teams.server'
import type { InviteMemberInput } from './auth.schemas'

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
  if (row.status !== 'pending') return { id: row.id, state: 'closed' as const }
  if (row.expiresAt <= now) {
    return {
      id: row.id,
      state: 'expired' as const,
      organizationName: row.organizationName,
      inviterName: row.inviterName,
    }
  }
  return {
    id: row.id,
    state: 'pending' as const,
    email: row.email,
    role: strongestRole(row.role ?? 'member'),
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    teamName: row.teamName,
    inviterName: row.inviterName,
  }
}

// Open invitations, expired ones included so they can get a new link.
export async function listInvitations(db: Database, scope: Scope) {
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      teamId: invitation.teamId,
      inviterId: invitation.inviterId,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(
      and(eq(invitation.organizationId, scope.organizationId), eq(invitation.status, 'pending')),
    )
  return rows.map((row) => ({ ...row, role: strongestRole(row.role ?? 'member') }))
}

// Better Auth owns invitation permissions and email checks. The app stores the optional team.
export async function inviteMember<T extends { id: string }>(
  db: Database,
  scope: Scope,
  input: InviteMemberInput,
  invite: () => Promise<T>,
) {
  if (!isAdmin(scope)) throw new AppError('FORBIDDEN', 'organization_forbidden')
  if (input.teamId) await assertTeamInScope(db, scope, input.teamId)
  const created = await invite()
  if (input.teamId) {
    await db.transaction(async (tx) => {
      // A team deleted while Better Auth was creating the link leaves an organization invitation.
      const [found] = await tx
        .select({ id: team.id })
        .from(team)
        .where(and(eq(team.id, input.teamId!), eq(team.organizationId, scope.organizationId)))
      if (found)
        await tx
          .update(invitation)
          .set({ teamId: found.id })
          .where(
            and(eq(invitation.id, created.id), eq(invitation.organizationId, scope.organizationId)),
          )
    })
  }
  return created
}

// Better Auth checks the recipient and adds the member; the app then adds them to the
// invitation's team. The two steps aren't atomic: if the second fails, the person has joined
// the organization without the team, and an admin adds them.
export async function acceptInvitation(
  db: Database,
  userId: string,
  invitationId: string,
  accept: () => Promise<unknown>,
) {
  await accept()
  await db.transaction(async (tx) => {
    const [found] = await tx
      .select({ teamId: invitation.teamId })
      .from(invitation)
      .where(and(eq(invitation.id, invitationId), eq(invitation.status, 'accepted')))
    if (found?.teamId) await insertTeamMember(tx, found.teamId, userId)
  })
  return { id: invitationId }
}
