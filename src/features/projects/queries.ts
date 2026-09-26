// The Projects view's queries and its optimistic mutations. Projects live in the cache
// the timer reads too (src/lib/projects.ts), so each write shows there at once as well.
import { queryOptions, useMutation, useQueryClient } from '@tanstack/solid-query'
import { localDate, monthDates } from '~/lib/calendar'
import type { Project } from '~/lib/projects'
import { cacheUpdate, optimistic, reportsKey } from '~/lib/query'
import {
  archiveProject,
  assignProjectToTeam,
  createProject,
  deleteProject,
  unarchiveProject,
  unassignProjectFromTeam,
  updateProject,
} from '~/server/projects/projects.functions'
import type { ProjectIdInput } from '~/server/projects/projects.schemas'
import { getReport } from '~/server/reports/reports.functions'

// Time per project this month in the user's zone: the organization's for admins and
// owners, the user's own otherwise. Without a userId a team lead would get their teams'
// time, which belongs in Reports.
export function monthReportQuery(organizationId: string, zone: string, userId: string | null) {
  const { from, to } = monthDates(localDate(Date.now(), zone))
  return queryOptions({
    queryKey: [...reportsKey, organizationId, { from, to, userId }],
    queryFn: () => getReport({ data: { organizationId, from, to, ...(userId ? { userId } : {}) } }),
  })
}

// Creating sends the name, color and every team; editing sends only what changed.
export type SaveProjectInput =
  | { kind: 'create'; id: string; name: string; color: string; teamIds: string[] }
  | {
      kind: 'update'
      id: string
      name?: string
      color?: string
      assign: string[]
      unassign: string[]
    }

// The organization the view shows, which the writes below act in.
type Keys = { organizationId: string }

function projectsKey(organizationId: string) {
  return ['projects', organizationId]
}

// The project exists before its teams are assigned, so the calls run in that order.
async function saveProject(organizationId: string, input: SaveProjectInput) {
  const { id } = input
  if (input.kind === 'create') {
    await createProject({ data: { organizationId, id, name: input.name, color: input.color } })
  } else if (input.name !== undefined || input.color !== undefined) {
    await updateProject({ data: { organizationId, id, name: input.name, color: input.color } })
  }
  const assign = input.kind === 'create' ? input.teamIds : input.assign
  const unassign = input.kind === 'create' ? [] : input.unassign
  await Promise.all([
    ...assign.map((teamId) =>
      assignProjectToTeam({ data: { organizationId, projectId: id, teamId } }),
    ),
    ...unassign.map((teamId) =>
      unassignProjectFromTeam({ data: { organizationId, projectId: id, teamId } }),
    ),
  ])
}

function saved(projects: Project[], input: SaveProjectInput): Project[] {
  if (input.kind === 'create') {
    const { id, name, color, teamIds } = input
    return [...projects, { id, name, color, teamIds, archivedAt: null }]
  }
  return projects.map((p) =>
    p.id === input.id
      ? {
          ...p,
          name: input.name ?? p.name,
          color: input.color ?? p.color,
          teamIds: [...p.teamIds.filter((t) => !input.unassign.includes(t)), ...input.assign],
        }
      : p,
  )
}

export function useSaveProject({ organizationId }: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: SaveProjectInput) => saveProject(organizationId, input),
    ...optimistic(queryClient, [
      cacheUpdate<Project[], SaveProjectInput>(projectsKey(organizationId), saved),
    ]),
  }))
}

function setArchived(projects: Project[], id: string, archivedAt: Date | null) {
  return projects.map((p) => (p.id === id ? { ...p, archivedAt } : p))
}

export function useArchiveProject({ organizationId }: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: ProjectIdInput) => archiveProject({ data: { ...input, organizationId } }),
    ...optimistic(queryClient, [
      cacheUpdate<Project[], ProjectIdInput>(projectsKey(organizationId), (projects, { id }) =>
        setArchived(projects, id, new Date()),
      ),
    ]),
  }))
}

export function useUnarchiveProject({ organizationId }: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: ProjectIdInput) => unarchiveProject({ data: { ...input, organizationId } }),
    ...optimistic(queryClient, [
      cacheUpdate<Project[], ProjectIdInput>(projectsKey(organizationId), (projects, { id }) =>
        setArchived(projects, id, null),
      ),
    ]),
  }))
}

// A project with time entries is refused with CONFLICT, so the row waits up to
// DELETE_DELAY ms for the answer, shown as pending, before it goes (optimistic's `delay`).
const DELETE_DELAY = 500
export const deleteProjectKey = ['delete-project']

export function useDeleteProject({ organizationId }: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationKey: deleteProjectKey,
    mutationFn: (input: ProjectIdInput) => deleteProject({ data: { ...input, organizationId } }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Project[], ProjectIdInput>(projectsKey(organizationId), (projects, { id }) =>
          projects.filter((p) => p.id !== id),
        ),
      ],
      { delay: DELETE_DELAY },
    ),
  }))
}
