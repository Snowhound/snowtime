// The Organization view's queries and its optimistic mutations. Each call names the
// organization the view shows, since the session's active one can change in another tab.
// Members, teams and projects live in the caches Reports, Projects and the timer read too, so
// each change shows there as well.
import { queryOptions, useMutation, useQueryClient } from '@tanstack/solid-query'
import { isServer } from 'solid-js/web'
import { call } from '~/lib/api/client'
import { authClient, unwrap } from '~/lib/auth-client'
import { type Member, membersQuery } from '~/lib/queries/members'
import type { Project } from '~/lib/queries/projects'
import { cacheUpdate, newId, optimistic, reportsKey } from '~/lib/queries/query'
import { sessionQuery } from '~/lib/queries/session'
import { type Team, teamsQuery } from '~/lib/queries/teams'
import type { AppSession, Invitation } from '~/server/auth/auth.schemas'
import type { SetTeamRoleInput } from '~/server/teams/teams.schemas'
import type { OrgRole } from './roles'

// An invitation link lasts 48 hours (invitationExpiresIn in better-auth.server.ts).
const INVITATION_HOURS = 48
const HOUR = 3_600_000

export type { Invitation }

export function isExpired(invitation: Invitation, now = Date.now()) {
  return invitation.expiresAt.getTime() <= now
}

export function invitationLink(appUrl: string, id: string) {
  return `${appUrl}/invitation/${id}`
}

export function invitationsQuery(organizationId: string) {
  return queryOptions({
    queryKey: ['invitations', organizationId],
    queryFn: () => call('listInvitations', { organizationId }),
    enabled: !isServer,
  })
}

type Keys = { organizationId: string }

// Reports total a team's time from its current members, so a change to who is in a team
// changes them.
const teamTotals = { invalidate: [reportsKey] }

function membersKey(organizationId: string) {
  return membersQuery(organizationId).queryKey
}
function teamsKey(organizationId: string) {
  return teamsQuery(organizationId).queryKey
}
function invitationsKey(organizationId: string) {
  return invitationsQuery(organizationId).queryKey
}

// --- Members ---------------------------------------------------------------------------

export interface MemberRoleInput {
  memberId: string
  role: OrgRole
}

export function useUpdateMemberRole(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: ({ memberId, role }: MemberRoleInput) =>
      unwrap(
        authClient.organization.updateMemberRole({
          memberId,
          role,
          organizationId: keys.organizationId,
        }),
      ),
    ...optimistic(queryClient, [
      cacheUpdate<Member[], MemberRoleInput>(membersKey(keys.organizationId), (members, input) =>
        members.map((m) => (m.memberId === input.memberId ? { ...m, orgRole: input.role } : m)),
      ),
    ]),
  }))
}

export interface MemberInput {
  memberId: string
  userId: string
}

// The removal hook deletes team rows, lead roles included.
export function useRemoveMember(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: ({ memberId }: MemberInput) =>
      unwrap(
        authClient.organization.removeMember({
          memberIdOrEmail: memberId,
          organizationId: keys.organizationId,
        }),
      ),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Member[], MemberInput>(membersKey(keys.organizationId), (members, input) =>
          members.filter((m) => m.memberId !== input.memberId),
        ),
        cacheUpdate<Team[], MemberInput>(teamsKey(keys.organizationId), (teams, input) =>
          teams.map((t) => ({ ...t, members: t.members.filter((m) => m.userId !== input.userId) })),
        ),
      ],
      teamTotals,
    ),
  }))
}

// --- Invitations -----------------------------------------------------------------------

export interface InviteInput {
  email: string
  role: OrgRole
  teamId: string | null
  // An expired invitation to the same address, canceled once the new one exists, so the
  // list keeps one row per address.
  replaces?: string
}

// Better Auth gives the new invitation its id, so the optimistic row has a stand-in until
// the refetch; the invite dialog waits for the real one to show its link.
export function useInviteMember(keys: Keys & { userId: string }) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: async (input: InviteInput) => {
      const created = await call('inviteMember', {
        email: input.email,
        role: input.role,
        organizationId: keys.organizationId,
        teamId: input.teamId,
      })
      if (input.replaces) {
        await unwrap(authClient.organization.cancelInvitation({ invitationId: input.replaces }))
      }
      return created
    },
    ...optimistic(queryClient, [
      cacheUpdate<Invitation[], InviteInput>(
        invitationsKey(keys.organizationId),
        (invitations, input) => [
          ...invitations.filter((i) => i.id !== input.replaces),
          {
            id: newId(),
            email: input.email,
            role: input.role,
            teamId: input.teamId,
            inviterId: keys.userId,
            expiresAt: new Date(Date.now() + INVITATION_HOURS * HOUR),
          },
        ],
      ),
    ]),
  }))
}

export function useCancelInvitation(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (invitation: Invitation) =>
      unwrap(authClient.organization.cancelInvitation({ invitationId: invitation.id })),
    ...optimistic(queryClient, [
      cacheUpdate<Invitation[], Invitation>(
        invitationsKey(keys.organizationId),
        (invitations, invitation) => invitations.filter((i) => i.id !== invitation.id),
      ),
    ]),
  }))
}

// --- Teams -----------------------------------------------------------------------------

// The server gives a new team its id; `id` is the optimistic card's stand-in.
export interface CreateTeamInput {
  id: string
  name: string
}

export function useCreateTeam(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationKey: ['create-team'],
    mutationFn: ({ name }: CreateTeamInput) =>
      call('createTeam', { name, organizationId: keys.organizationId }),
    ...optimistic(queryClient, [
      cacheUpdate<Team[], CreateTeamInput>(teamsKey(keys.organizationId), (teams, { id, name }) => [
        ...teams,
        { id, name, members: [] },
      ]),
    ]),
  }))
}

export interface RenameTeamInput {
  teamId: string
  name: string
}

export function useRenameTeam(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: ({ teamId, name }: RenameTeamInput) =>
      call('renameTeam', { teamId, name, organizationId: keys.organizationId }),
    ...optimistic(queryClient, [
      cacheUpdate<Team[], RenameTeamInput>(teamsKey(keys.organizationId), (teams, input) =>
        teams.map((t) => (t.id === input.teamId ? { ...t, name: input.name } : t)),
      ),
    ]),
  }))
}

// Deleting a team cascades its members; the database cascades its project rows, so
// projects left without teams open to the whole organization.
export function useDeleteTeam(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (teamId: string) =>
      call('deleteTeam', { teamId, organizationId: keys.organizationId }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Team[], string>(teamsKey(keys.organizationId), (teams, teamId) =>
          teams.filter((t) => t.id !== teamId),
        ),
        cacheUpdate<Member[], string>(membersKey(keys.organizationId), (members, teamId) =>
          members.map((m) => ({ ...m, teams: m.teams.filter((t) => t.teamId !== teamId) })),
        ),
        cacheUpdate<Project[], string>(['projects', keys.organizationId], (projects, teamId) =>
          projects.map((p) => ({ ...p, teamIds: p.teamIds.filter((t) => t !== teamId) })),
        ),
      ],
      teamTotals,
    ),
  }))
}

export interface TeamMemberInput {
  teamId: string
  userId: string
}

function withTeamMember(add: boolean) {
  return [
    (teams: Team[], input: TeamMemberInput) =>
      teams.map((t) =>
        t.id !== input.teamId
          ? t
          : {
              ...t,
              members: add
                ? [...t.members, { userId: input.userId, role: 'member' as const }]
                : t.members.filter((m) => m.userId !== input.userId),
            },
      ),
    (members: Member[], input: TeamMemberInput) =>
      members.map((m) =>
        m.userId !== input.userId
          ? m
          : {
              ...m,
              teams: add
                ? [...m.teams, { teamId: input.teamId, role: 'member' as const }]
                : m.teams.filter((t) => t.teamId !== input.teamId),
            },
      ),
  ] as const
}

// A new team member starts as a member; team_member.role defaults to it.
export function useAddTeamMember(keys: Keys) {
  const queryClient = useQueryClient()
  const [teams, members] = withTeamMember(true)
  return useMutation(() => ({
    mutationFn: (input: TeamMemberInput) =>
      call('addTeamMember', { ...input, organizationId: keys.organizationId }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate(teamsKey(keys.organizationId), teams),
        cacheUpdate(membersKey(keys.organizationId), members),
      ],
      teamTotals,
    ),
  }))
}

export function useRemoveTeamMember(keys: Keys) {
  const queryClient = useQueryClient()
  const [teams, members] = withTeamMember(false)
  return useMutation(() => ({
    mutationFn: (input: TeamMemberInput) =>
      call('removeTeamMember', { ...input, organizationId: keys.organizationId }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate(teamsKey(keys.organizationId), teams),
        cacheUpdate(membersKey(keys.organizationId), members),
      ],
      teamTotals,
    ),
  }))
}

export function useSetTeamRole(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: SetTeamRoleInput) =>
      call('setTeamRole', { ...input, organizationId: keys.organizationId }),
    ...optimistic(queryClient, [
      cacheUpdate<Team[], SetTeamRoleInput>(teamsKey(keys.organizationId), (teams, input) =>
        teams.map((t) =>
          t.id !== input.teamId
            ? t
            : {
                ...t,
                members: t.members.map((m) =>
                  m.userId === input.userId ? { ...m, role: input.role } : m,
                ),
              },
        ),
      ),
      cacheUpdate<Member[], SetTeamRoleInput>(membersKey(keys.organizationId), (members, input) =>
        members.map((m) =>
          m.userId !== input.userId
            ? m
            : {
                ...m,
                teams: m.teams.map((t) =>
                  t.teamId === input.teamId ? { ...t, role: input.role } : t,
                ),
              },
        ),
      ),
    ]),
  }))
}

// --- General ---------------------------------------------------------------------------

// The name shows in the switcher, which reads the session.
export function useRenameOrganization(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (name: string) =>
      unwrap(
        authClient.organization.update({ organizationId: keys.organizationId, data: { name } }),
      ),
    ...optimistic(queryClient, [
      cacheUpdate<AppSession | null, string>(sessionQuery.queryKey, (session, name) =>
        session
          ? {
              ...session,
              organizations: session.organizations.map((o) =>
                o.id === keys.organizationId ? { ...o, name } : o,
              ),
            }
          : session,
      ),
    ]),
  }))
}

// The Issue links setting, which ticket chips on the timer read from the session.
export function useUpdateIssueLinks(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (issueLinks: string | null) =>
      call('updateIssueLinks', {
        organizationId: keys.organizationId,
        issueLinks: issueLinks ?? '',
      }),
    ...optimistic(queryClient, [
      cacheUpdate<AppSession | null, string | null>(sessionQuery.queryKey, (session, issueLinks) =>
        session
          ? {
              ...session,
              organizations: session.organizations.map((o) =>
                o.id === keys.organizationId ? { ...o, issueLinks } : o,
              ),
            }
          : session,
      ),
    ]),
  }))
}
