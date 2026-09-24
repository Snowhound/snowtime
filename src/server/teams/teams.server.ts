// Teams and members of the scope's organization. Better Auth's organization plugin owns
// teams, team membership and invitations, and the UI calls it for those; these rules cover
// what the plugin cannot: team roles (team_member.role is an app column) and lists that
// include them (docs/architecture.md, "Tenancy").
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Database } from '~/db'
import { member, team, teamMember, user } from '~/db/schema'
import { AppError } from '../errors'
import { isAdmin, strongestRole, type Scope } from '../scope.server'
import type { SetTeamRoleInput } from './teams.schemas'

// Makes a team member a lead, or a lead a plain member again. Admins and owners only.
export async function setTeamRole(db: Database, scope: Scope, input: SetTeamRoleInput) {
  if (!isAdmin(scope)) throw new AppError('FORBIDDEN', 'teams_forbidden')
  const [found] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, input.teamId), eq(team.organizationId, scope.organizationId)))
  if (!found) throw new AppError('NOT_FOUND', 'team_not_found')

  const [updated] = await db
    .update(teamMember)
    .set({ role: input.role })
    .where(and(eq(teamMember.teamId, input.teamId), eq(teamMember.userId, input.userId)))
    .returning({ teamId: teamMember.teamId, userId: teamMember.userId, role: teamMember.role })
  if (!updated) throw new AppError('NOT_FOUND', 'team_member_not_found')
  return updated
}

async function teamMemberships(db: Database, teamIds: string[]) {
  if (teamIds.length === 0) return []
  return db
    .select({ teamId: teamMember.teamId, userId: teamMember.userId, role: teamMember.role })
    .from(teamMember)
    .where(inArray(teamMember.teamId, teamIds))
}

// The organization's members by name, each with their organization role and their teams.
// Any member may list them, as with the plugin's own member list.
export async function listMembers(db: Database, scope: Scope) {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, scope.organizationId))
    .orderBy(asc(user.name))
  const teams = await db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.organizationId, scope.organizationId))
  const memberships = await teamMemberships(
    db,
    teams.map((t) => t.id),
  )
  return rows.map(({ role, ...m }) => ({
    ...m,
    orgRole: strongestRole(role),
    teams: memberships
      .filter((t) => t.userId === m.userId)
      .map(({ teamId, role }) => ({ teamId, role })),
  }))
}

// The organization's teams by name, each with its members and their team roles.
export async function listTeams(db: Database, scope: Scope) {
  const teams = await db
    .select({ id: team.id, name: team.name })
    .from(team)
    .where(eq(team.organizationId, scope.organizationId))
    .orderBy(asc(team.name))
  const memberships = await teamMemberships(
    db,
    teams.map((t) => t.id),
  )
  return teams.map((t) => ({
    ...t,
    members: memberships
      .filter((m) => m.teamId === t.id)
      .map(({ userId, role }) => ({ userId, role })),
  }))
}
