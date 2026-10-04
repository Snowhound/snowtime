import * as v from 'valibot'
import {
  type CreateProjectInput,
  ListedProject,
  type ListProjectsInput,
  Project,
  type ProjectIdInput,
  type ProjectTeamInput,
  type UpdateProjectInput,
} from '~/server/projects/projects.schemas'
import { request } from './request'

type In<S extends v.GenericSchema> = v.InferInput<S> & { organizationId: string }

function path(organizationId: string) {
  return `/api/v1/organizations/${organizationId}/projects`
}

const ProjectTeam = v.object({ projectId: v.string(), teamId: v.string() })

export function listProjects({ organizationId, ...input }: In<typeof ListProjectsInput>) {
  return request('GET', path(organizationId), input, v.array(ListedProject))
}

export function createProject({ organizationId, ...input }: In<typeof CreateProjectInput>) {
  return request('POST', path(organizationId), input, Project)
}

export function updateProject({ organizationId, id, ...patch }: In<typeof UpdateProjectInput>) {
  return request('PATCH', `${path(organizationId)}/${id}`, patch, Project)
}

export function archiveProject({ organizationId, id }: In<typeof ProjectIdInput>) {
  return request('POST', `${path(organizationId)}/${id}/archive`, undefined, Project)
}

export function unarchiveProject({ organizationId, id }: In<typeof ProjectIdInput>) {
  return request('POST', `${path(organizationId)}/${id}/unarchive`, undefined, Project)
}

export function deleteProject({ organizationId, id }: In<typeof ProjectIdInput>) {
  return request('DELETE', `${path(organizationId)}/${id}`, undefined, v.object({ id: v.string() }))
}

export function assignProjectToTeam({
  organizationId,
  projectId,
  teamId,
}: In<typeof ProjectTeamInput>) {
  return request(
    'PUT',
    `${path(organizationId)}/${projectId}/teams/${teamId}`,
    undefined,
    ProjectTeam,
  )
}

export function unassignProjectFromTeam({
  organizationId,
  projectId,
  teamId,
}: In<typeof ProjectTeamInput>) {
  return request(
    'DELETE',
    `${path(organizationId)}/${projectId}/teams/${teamId}`,
    undefined,
    ProjectTeam,
  )
}
