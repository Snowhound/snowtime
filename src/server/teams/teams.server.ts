// Teams and team membership in the scope's organization: writes, team roles, and the lists
// that include them (docs/architecture/data.md, "Tenancy").
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { Database, Executor } from '~/db'
import { member, team, teamMember, user } from '~/db/schema'
import { AppError } from '../errors'
import { limits } from '../limits.server'
import { allInOrder, failedConstraint } from '../queries.server'
import { isAdmin, strongestRole, type Scope } from '../scope.server'
import type {
  CreateTeamInput,
  RenameTeamInput,
  TeamIdInput,
  TeamMemberInput,
  SetTeamRoleInput,
} from './teams.schemas'

function assertAdmin(scope: Scope) {
  if (!isAdmin(scope)) throw new AppError('FORBIDDEN', 'teams_forbidden')
}

export async function assertTeamInScope(
  db: Executor,
  scope: Pick<Scope, 'organizationId'>,
  teamId: string,
) {
  const [found] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, scope.organizationId)))
  if (!found) throw new AppError('NOT_FOUND', 'team_not_found')
}

function nameFailure(error: unknown): never {
  if (failedConstraint(error) === 'team.organization_id, team.name')
    throw new AppError('CONFLICT', 'team_name_taken')
  throw error
}

export async function createTeam(db: Database, scope: Scope, input: CreateTeamInput) {
  assertAdmin(scope)
  return db.transaction(async (tx) => {
    const [total] = await tx
      .select({ count: count() })
      .from(team)
      .where(eq(team.organizationId, scope.organizationId))
    if (total.count >= limits.teamsPerOrganization)
      throw new AppError('LIMIT_REACHED', 'team_limit')
    try {
      const [created] = await tx
        .insert(team)
        .values({
          id: uuidv7(),
          organizationId: scope.organizationId,
          name: input.name,
          createdAt: new Date(),
        })
        .returning({ id: team.id, name: team.name })
      return created
    } catch (error) {
      return nameFailure(error)
    }
  })
}

export async function renameTeam(db: Database, scope: Scope, input: RenameTeamInput) {
  assertAdmin(scope)
  try {
    const [updated] = await db
      .update(team)
      .set({ name: input.name, updatedAt: new Date() })
      .where(and(eq(team.id, input.teamId), eq(team.organizationId, scope.organizationId)))
      .returning({ id: team.id, name: team.name })
    if (!updated) throw new AppError('NOT_FOUND', 'team_not_found')
    return updated
  } catch (error) {
    return nameFailure(error)
  }
}

export async function deleteTeam(db: Database, scope: Scope, input: TeamIdInput) {
  assertAdmin(scope)
  const [deleted] = await db
    .delete(team)
    .where(and(eq(team.id, input.teamId), eq(team.organizationId, scope.organizationId)))
    .returning({ id: team.id })
  if (!deleted) throw new AppError('NOT_FOUND', 'team_not_found')
  return deleted
}

// Called only after the caller has authorized the write or Better Auth has accepted an invitation.
export async function insertTeamMember(db: Executor, teamId: string, userId: string) {
  const [added] = await db
    .insert(teamMember)
    .values({ id: uuidv7(), teamId, userId, createdAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: teamMember.id })
  if (added)
    await db
      .update(team)
      .set({ memberCount: sql`${team.memberCount} + 1` })
      .where(eq(team.id, teamId))
}

export async function addTeamMember(db: Database, scope: Scope, input: TeamMemberInput) {
  assertAdmin(scope)
  return db.transaction(async (tx) => {
    const [, [found]] = await allInOrder([
      assertTeamInScope(tx, scope, input.teamId),
      tx
        .select({ id: member.id })
        .from(member)
        .where(
          and(eq(member.organizationId, scope.organizationId), eq(member.userId, input.userId)),
        ),
    ])
    if (!found) throw new AppError('NOT_FOUND', 'member_not_found')
    await insertTeamMember(tx, input.teamId, input.userId)
    return input
  })
}

export async function removeTeamMember(db: Database, scope: Scope, input: TeamMemberInput) {
  assertAdmin(scope)
  return db.transaction(async (tx) => {
    await assertTeamInScope(tx, scope, input.teamId)
    const [removed] = await tx
      .delete(teamMember)
      .where(and(eq(teamMember.teamId, input.teamId), eq(teamMember.userId, input.userId)))
      .returning({ id: teamMember.id })
    if (!removed) throw new AppError('NOT_FOUND', 'team_member_not_found')
    await tx
      .update(team)
      .set({ memberCount: sql`${team.memberCount} - 1` })
      .where(eq(team.id, input.teamId))
    return input
  })
}

export async function removeMemberTeams(db: Database, userId: string, organizationId: string) {
  await db.transaction(async (tx) => {
    const teams = tx
      .select({ id: team.id })
      .from(team)
      .where(eq(team.organizationId, organizationId))
    const removed = await tx
      .delete(teamMember)
      .where(and(eq(teamMember.userId, userId), inArray(teamMember.teamId, teams)))
      .returning({ teamId: teamMember.teamId })
    if (removed.length)
      await tx
        .update(team)
        .set({ memberCount: sql`${team.memberCount} - 1` })
        .where(
          inArray(
            team.id,
            removed.map((r) => r.teamId),
          ),
        )
  })
}

// Makes a team member a lead, or a lead a plain member again. Admins and owners only.
export async function setTeamRole(db: Database, scope: Scope, input: SetTeamRoleInput) {
  assertAdmin(scope)
  await assertTeamInScope(db, scope, input.teamId)

  const [updated] = await db
    .update(teamMember)
    .set({ role: input.role })
    .where(and(eq(teamMember.teamId, input.teamId), eq(teamMember.userId, input.userId)))
    .returning({ teamId: teamMember.teamId, userId: teamMember.userId, role: teamMember.role })
  if (!updated) throw new AppError('NOT_FOUND', 'team_member_not_found')
  return updated
}

// Every team membership in the organization. It needs no team ids, so it runs alongside
// the read it completes: each read is a round trip to the database.
function teamMemberships(db: Database, scope: Scope) {
  return db
    .select({ teamId: teamMember.teamId, userId: teamMember.userId, role: teamMember.role })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(eq(team.organizationId, scope.organizationId))
}

// The organization's members by name, each with their organization role and their teams.
// Any member may list them, as with the plugin's own member list. `memberId` is what the
// plugin's member calls take (updateMemberRole, removeMember).
export async function listMembers(db: Database, scope: Scope) {
  const [rows, memberships] = await Promise.all([
    db
      .select({
        memberId: member.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: member.role,
        joinedAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, scope.organizationId))
      .orderBy(asc(user.name)),
    teamMemberships(db, scope),
  ])
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
  const [teams, memberships] = await Promise.all([
    db
      .select({ id: team.id, name: team.name })
      .from(team)
      .where(eq(team.organizationId, scope.organizationId))
      .orderBy(asc(team.name)),
    teamMemberships(db, scope),
  ])
  return teams.map((t) => ({
    ...t,
    members: memberships
      .filter((m) => m.teamId === t.id)
      .map(({ userId, role }) => ({ userId, role })),
  }))
}
