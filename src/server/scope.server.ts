// The tenancy helper: who is acting, in which organization, with which rights. Every
// server function that touches tenant data gets its scope from here (through
// scopeMiddleware) and filters by scope.organizationId.
import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '~/db'
import { member, team, teamMember } from '~/db/schema'
import { AppError } from './errors'

export type OrgRole = 'owner' | 'admin' | 'member'

export interface Scope {
  userId: string
  organizationId: string
  orgRole: OrgRole
  // Teams in this organization the user leads; team leads read their members' entries.
  ledTeamIds: string[]
}

// Better Auth stores several roles as a comma-separated list; the strongest one wins.
export function strongestRole(role: string): OrgRole {
  const roles = role.split(',').map((r) => r.trim())
  if (roles.includes('owner')) return 'owner'
  if (roles.includes('admin')) return 'admin'
  return 'member'
}

export async function resolveScope(
  db: Database,
  userId: string,
  organizationId: string | null | undefined,
): Promise<Scope> {
  if (!organizationId) {
    throw new AppError('NO_ACTIVE_ORGANIZATION', 'organization_required')
  }
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
  if (!membership) {
    throw new AppError('FORBIDDEN', 'not_organization_member')
  }
  const led = await db
    .select({ teamId: teamMember.teamId })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(
      and(
        eq(teamMember.userId, userId),
        eq(teamMember.role, 'lead'),
        eq(team.organizationId, organizationId),
      ),
    )
  return {
    userId,
    organizationId,
    orgRole: strongestRole(membership.role),
    ledTeamIds: led.map((r) => r.teamId),
  }
}

export function isAdmin(scope: Scope): boolean {
  return scope.orgRole === 'owner' || scope.orgRole === 'admin'
}

// Users whose entries the scope may read: everyone for admins and owners (null), else the
// user plus the members of the teams they lead.
export async function readableUserIds(db: Database, scope: Scope): Promise<string[] | null> {
  if (isAdmin(scope)) return null
  if (scope.ledTeamIds.length === 0) return [scope.userId]
  const rows = await db
    .selectDistinct({ userId: teamMember.userId })
    .from(teamMember)
    .where(inArray(teamMember.teamId, scope.ledTeamIds))
  return [...new Set([scope.userId, ...rows.map((r) => r.userId)])]
}
