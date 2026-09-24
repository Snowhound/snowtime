// The Organization view's queries and its optimistic mutations. Members, teams and
// invitations are written through Better Auth's organization client; team roles through
// setTeamRole (docs/architecture.md, "Tenancy"). Members, teams and projects live in the
// caches Reports, Projects and the timer read too, so each change shows there as well.
import { queryOptions, useMutation, useQueryClient } from '@tanstack/solid-query'
import { isServer } from 'solid-js/web'
import { authClient, unwrap } from '~/lib/auth-client'
import type { Member } from '~/lib/members'
import type { Project } from '~/lib/projects'
import { cacheUpdate, newId, optimistic } from '~/lib/query'
import type { Team } from '~/lib/teams'
import { type AppSession, getAppUrl } from '~/server/auth/auth.functions'
import { setTeamRole } from '~/server/teams/teams.functions'
import type { SetTeamRoleInput } from '~/server/teams/teams.schemas'
import type { OrgRole } from './roles'

// An invitation link lasts 48 hours (invitationExpiresIn in better-auth.server.ts).
export const INVITATION_HOURS = 48
const HOUR = 3_600_000

export interface Invitation {
  id: string
  email: string
  role: OrgRole
  teamId: string | null
  inviterId: string
  expiresAt: Date
}

export function isExpired(invitation: Invitation, now = Date.now()) {
  return invitation.expiresAt.getTime() <= now
}

// The app's origin for invitation links; it never changes while the app runs.
export const appUrlQuery = queryOptions({
  queryKey: ['app-url'],
  queryFn: () => getAppUrl(),
  staleTime: Infinity,
})

export function invitationLink(appUrl: string, id: string) {
  return `${appUrl}/invitation/${id}`
}

// Open invitations, expired ones included so they can get a new link. They come from the
// browser: the Better Auth client can't call itself during server rendering.
export function invitationsQuery(organizationId: string) {
  return queryOptions({
    queryKey: ['invitations', organizationId],
    queryFn: async (): Promise<Invitation[]> => {
      const all = await unwrap(
        authClient.organization.listInvitations({ query: { organizationId } }),
      )
      return all
        .filter((i) => i.status === 'pending')
        .map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          teamId: i.teamId ?? null,
          inviterId: i.inviterId,
          expiresAt: new Date(i.expiresAt),
        }))
    },
    enabled: !isServer,
  })
}

type Keys = { organizationId: string }

function membersKey(organizationId: string) {
  return ['members', organizationId]
}
function teamsKey(organizationId: string) {
  return ['teams', organizationId]
}
function invitationsKey(organizationId: string) {
  return ['invitations', organizationId]
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
      unwrap(authClient.organization.updateMemberRole({ memberId, role })),
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

// Better Auth deletes the member's team rows too, lead roles included.
export function useRemoveMember(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: ({ memberId }: MemberInput) =>
      unwrap(authClient.organization.removeMember({ memberIdOrEmail: memberId })),
    ...optimistic(queryClient, [
      cacheUpdate<Member[], MemberInput>(membersKey(keys.organizationId), (members, input) =>
        members.filter((m) => m.memberId !== input.memberId),
      ),
      cacheUpdate<Team[], MemberInput>(teamsKey(keys.organizationId), (teams, input) =>
        teams.map((t) => ({ ...t, members: t.members.filter((m) => m.userId !== input.userId) })),
      ),
    ]),
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
      const created = await unwrap(
        authClient.organization.inviteMember({
          email: input.email,
          role: input.role,
          ...(input.teamId ? { teamId: input.teamId } : {}),
        }),
      )
      if (input.replaces) {
        await unwrap(authClient.organization.cancelInvitation({ invitationId: input.replaces }))
      }
      return { id: created.id, email: created.email, expiresAt: new Date(created.expiresAt) }
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

// Better Auth gives a new team its id; `id` is the optimistic card's stand-in.
export interface CreateTeamInput {
  id: string
  name: string
}

export function useCreateTeam(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationKey: ['create-team'],
    mutationFn: ({ name }: CreateTeamInput) => unwrap(authClient.organization.createTeam({ name })),
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
      unwrap(authClient.organization.updateTeam({ teamId, data: { name } })),
    ...optimistic(queryClient, [
      cacheUpdate<Team[], RenameTeamInput>(teamsKey(keys.organizationId), (teams, input) =>
        teams.map((t) => (t.id === input.teamId ? { ...t, name: input.name } : t)),
      ),
    ]),
  }))
}

// Better Auth deletes the team's members; the database cascades its project rows, so
// projects left without teams open to the whole organization.
export function useDeleteTeam(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (teamId: string) => unwrap(authClient.organization.removeTeam({ teamId })),
    ...optimistic(queryClient, [
      cacheUpdate<Team[], string>(teamsKey(keys.organizationId), (teams, teamId) =>
        teams.filter((t) => t.id !== teamId),
      ),
      cacheUpdate<Member[], string>(membersKey(keys.organizationId), (members, teamId) =>
        members.map((m) => ({ ...m, teams: m.teams.filter((t) => t.teamId !== teamId) })),
      ),
      cacheUpdate<Project[], string>(['projects', keys.organizationId], (projects, teamId) =>
        projects.map((p) => ({ ...p, teamIds: p.teamIds.filter((t) => t !== teamId) })),
      ),
    ]),
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
    mutationFn: (input: TeamMemberInput) => unwrap(authClient.organization.addTeamMember(input)),
    ...optimistic(queryClient, [
      cacheUpdate(teamsKey(keys.organizationId), teams),
      cacheUpdate(membersKey(keys.organizationId), members),
    ]),
  }))
}

export function useRemoveTeamMember(keys: Keys) {
  const queryClient = useQueryClient()
  const [teams, members] = withTeamMember(false)
  return useMutation(() => ({
    mutationFn: (input: TeamMemberInput) => unwrap(authClient.organization.removeTeamMember(input)),
    ...optimistic(queryClient, [
      cacheUpdate(teamsKey(keys.organizationId), teams),
      cacheUpdate(membersKey(keys.organizationId), members),
    ]),
  }))
}

export function useSetTeamRole(keys: Keys) {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: SetTeamRoleInput) => setTeamRole({ data: input }),
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
      cacheUpdate<AppSession | null, string>(['session'], (session, name) =>
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
