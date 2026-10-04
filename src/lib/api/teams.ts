import * as v from 'valibot'
import {
  type CreateTeamInput,
  Member,
  type RenameTeamInput,
  type SetTeamRoleInput,
  Team,
  type TeamIdInput,
  type TeamMemberInput,
  TeamMembership,
  TeamName,
} from '~/server/teams/teams.schemas'
import { request } from './request'

type In<S extends v.GenericSchema> = v.InferInput<S> & { organizationId: string }

function path(organizationId: string) {
  return `/api/v1/organizations/${organizationId}`
}

const TeamMember = v.object({ teamId: v.string(), userId: v.string() })

export function listTeams({ organizationId }: { organizationId: string }) {
  return request('GET', `${path(organizationId)}/teams`, undefined, v.array(Team))
}

export function createTeam({ organizationId, ...input }: In<typeof CreateTeamInput>) {
  return request('POST', `${path(organizationId)}/teams`, input, TeamName)
}

export function renameTeam({ organizationId, teamId, ...input }: In<typeof RenameTeamInput>) {
  return request('PATCH', `${path(organizationId)}/teams/${teamId}`, input, TeamName)
}

export function deleteTeam({ organizationId, teamId }: In<typeof TeamIdInput>) {
  return request(
    'DELETE',
    `${path(organizationId)}/teams/${teamId}`,
    undefined,
    v.object({ id: v.string() }),
  )
}

export function addTeamMember({ organizationId, teamId, userId }: In<typeof TeamMemberInput>) {
  return request(
    'PUT',
    `${path(organizationId)}/teams/${teamId}/members/${userId}`,
    undefined,
    TeamMember,
  )
}

export function removeTeamMember({ organizationId, teamId, userId }: In<typeof TeamMemberInput>) {
  return request(
    'DELETE',
    `${path(organizationId)}/teams/${teamId}/members/${userId}`,
    undefined,
    TeamMember,
  )
}

export function setTeamRole({
  organizationId,
  teamId,
  userId,
  ...input
}: In<typeof SetTeamRoleInput>) {
  return request(
    'PATCH',
    `${path(organizationId)}/teams/${teamId}/members/${userId}`,
    input,
    TeamMembership,
  )
}

export function listMembers({ organizationId }: { organizationId: string }) {
  return request('GET', `${path(organizationId)}/members`, undefined, v.array(Member))
}
