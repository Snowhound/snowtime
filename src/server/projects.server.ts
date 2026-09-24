// Project rules shared by the timer and entry server functions.
import { and, eq, inArray } from 'drizzle-orm'
import type { Executor } from '../db'
import { project, projectTeam, teamMember } from '../db/schema'
import { AppError } from './errors'
import { live } from './queries.server'
import { isAdmin, type Scope } from './scope.server'

// Checks that new time can be logged on the project: it exists in the scope's
// organization, is not deleted or archived, and the user may see it. Projects assigned to
// teams are visible to those teams' members; unassigned ones to everyone; admins and
// owners see all.
export async function assertUsableProject(db: Executor, scope: Scope, projectId: string) {
  const [row] = await db
    .select({ archivedAt: project.archivedAt })
    .from(project)
    .where(and(eq(project.id, projectId), live(project, scope)))
  if (!row) throw new AppError('NOT_FOUND', 'Project not found.')
  if (row.archivedAt) throw new AppError('CONFLICT', 'The project is archived.')
  if (isAdmin(scope)) return

  const teams = await db
    .select({ teamId: projectTeam.teamId })
    .from(projectTeam)
    .where(eq(projectTeam.projectId, projectId))
  if (teams.length === 0) return
  const [inTeam] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(
      and(
        eq(teamMember.userId, scope.userId),
        inArray(
          teamMember.teamId,
          teams.map((t) => t.teamId),
        ),
      ),
    )
    .limit(1)
  if (!inTeam) throw new AppError('NOT_FOUND', 'Project not found.')
}
