// Projects in the scope's organization. Everyone lists the projects they may see; admins
// and owners create, change, archive and assign them. The timer and entry server
// functions check projects through assertUsableProject.
import { and, asc, eq, exists, inArray, isNull, notExists, or, type SQL } from 'drizzle-orm'
import type { Database, Executor } from '../db'
import { project, projectTeam, team, teamMember } from '../db/schema'
import type {
  CreateProjectInput,
  ListProjectsInput,
  ProjectIdInput,
  ProjectTeamInput,
  UpdateProjectInput,
} from '../schemas/projects'
import { AppError } from './errors'
import { failedConstraint, live } from './queries.server'
import { isAdmin, type Scope } from './scope.server'

const NAME_TAKEN = 'A project with this name already exists.'

// Projects the scope's user may see: unassigned ones, those assigned to one of the user's
// teams, and for admins and owners all. Combine it with live(project, scope).
function visibleProjects(db: Executor, scope: Scope): SQL | undefined {
  if (isAdmin(scope)) return undefined
  const assignments = db
    .select({ one: projectTeam.projectId })
    .from(projectTeam)
    .where(eq(projectTeam.projectId, project.id))
  const ownTeamAssignments = db
    .select({ one: projectTeam.projectId })
    .from(projectTeam)
    .innerJoin(teamMember, eq(teamMember.teamId, projectTeam.teamId))
    .where(and(eq(projectTeam.projectId, project.id), eq(teamMember.userId, scope.userId)))
  return or(notExists(assignments), exists(ownTeamAssignments))
}

function assertAdmin(scope: Scope) {
  if (!isAdmin(scope)) {
    throw new AppError('FORBIDDEN', 'Only admins can manage projects.')
  }
}

async function findProject(db: Executor, scope: Scope, id: string) {
  const [row] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, id), live(project, scope)))
  if (!row) throw new AppError('NOT_FOUND', 'Project not found.')
  return row
}

// Checks that new time can be logged on the project: it exists in the scope's
// organization, is not deleted or archived, and the user may see it.
export async function assertUsableProject(db: Executor, scope: Scope, projectId: string) {
  const [row] = await db
    .select({ archivedAt: project.archivedAt })
    .from(project)
    .where(and(eq(project.id, projectId), live(project, scope), visibleProjects(db, scope)))
  if (!row) throw new AppError('NOT_FOUND', 'Project not found.')
  if (row.archivedAt) throw new AppError('CONFLICT', 'The project is archived.')
}

// The projects the user may see, by name, each with the ids of the teams it is assigned
// to. Archived ones only on request.
export async function listProjects(db: Database, scope: Scope, input: ListProjectsInput) {
  const rows = await db
    .select()
    .from(project)
    .where(
      and(
        live(project, scope),
        visibleProjects(db, scope),
        input.includeArchived ? undefined : isNull(project.archivedAt),
      ),
    )
    .orderBy(asc(project.name))
  if (rows.length === 0) return []

  const assignments = await db
    .select({ projectId: projectTeam.projectId, teamId: projectTeam.teamId })
    .from(projectTeam)
    .where(
      and(
        eq(projectTeam.organizationId, scope.organizationId),
        inArray(
          projectTeam.projectId,
          rows.map((p) => p.id),
        ),
      ),
    )
  return rows.map((p) => ({
    ...p,
    teamIds: assignments.filter((a) => a.projectId === p.id).map((a) => a.teamId),
  }))
}

export async function createProject(db: Database, scope: Scope, input: CreateProjectInput) {
  assertAdmin(scope)
  try {
    const [created] = await db
      .insert(project)
      .values({
        id: input.id,
        organizationId: scope.organizationId,
        name: input.name,
        color: input.color,
      })
      .returning()
    return created
  } catch (error) {
    const failed = failedConstraint(error)
    // The (id, organization_id) index behind the composite foreign keys fails before the
    // primary key does.
    if (failed === 'project.id' || failed === 'project.id, project.organization_id') {
      throw new AppError('CONFLICT', 'A project with this id already exists.')
    }
    if (failed === 'project.organization_id, project.name') {
      throw new AppError('CONFLICT', NAME_TAKEN)
    }
    throw error
  }
}

// Updates the fields present in input. Archived projects can still be renamed.
export async function updateProject(db: Database, scope: Scope, input: UpdateProjectInput) {
  assertAdmin(scope)
  const existing = await findProject(db, scope, input.id)
  try {
    const [updated] = await db
      .update(project)
      .set({ name: input.name, color: input.color })
      .where(and(eq(project.id, existing.id), live(project, scope)))
      .returning()
    if (!updated) throw new AppError('NOT_FOUND', 'Project not found.')
    return updated
  } catch (error) {
    if (failedConstraint(error) === 'project.organization_id, project.name') {
      throw new AppError('CONFLICT', NAME_TAKEN)
    }
    throw error
  }
}

// Sets or clears archived_at. Archiving is lifecycle, not deletion: existing entries keep
// the project, but no new time can be logged on it. Repeating the call changes nothing.
async function setArchived(db: Database, scope: Scope, id: string, archived: boolean) {
  assertAdmin(scope)
  const existing = await findProject(db, scope, id)
  if (Boolean(existing.archivedAt) === archived) return existing
  const [updated] = await db
    .update(project)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(project.id, existing.id), live(project, scope)))
    .returning()
  if (!updated) throw new AppError('NOT_FOUND', 'Project not found.')
  return updated
}

export function archiveProject(db: Database, scope: Scope, input: ProjectIdInput) {
  return setArchived(db, scope, input.id, true)
}

export function unarchiveProject(db: Database, scope: Scope, input: ProjectIdInput) {
  return setArchived(db, scope, input.id, false)
}

async function assertTeamInScope(db: Executor, scope: Scope, teamId: string) {
  const [row] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, scope.organizationId)))
  if (!row) throw new AppError('NOT_FOUND', 'Team not found.')
}

// Restricts the project to the members of its assigned teams (plus admins and owners).
// Assigning it twice changes nothing.
export async function assignProjectToTeam(db: Database, scope: Scope, input: ProjectTeamInput) {
  assertAdmin(scope)
  await findProject(db, scope, input.projectId)
  await assertTeamInScope(db, scope, input.teamId)
  await db
    .insert(projectTeam)
    .values({ projectId: input.projectId, teamId: input.teamId, organizationId: scope.organizationId })
    .onConflictDoNothing()
  return { projectId: input.projectId, teamId: input.teamId }
}

// Removing the last team makes the project visible to everyone again.
export async function unassignProjectFromTeam(db: Database, scope: Scope, input: ProjectTeamInput) {
  assertAdmin(scope)
  await findProject(db, scope, input.projectId)
  await assertTeamInScope(db, scope, input.teamId)
  await db
    .delete(projectTeam)
    .where(
      and(
        eq(projectTeam.projectId, input.projectId),
        eq(projectTeam.teamId, input.teamId),
        eq(projectTeam.organizationId, scope.organizationId),
      ),
    )
  return { projectId: input.projectId, teamId: input.teamId }
}
