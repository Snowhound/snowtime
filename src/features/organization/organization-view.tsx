// The Organization view (prototypes/organization.html) for admins and owners: Members,
// Invitations, Teams, and General tabs, the tab kept in the URL. Writes are optimistic
// (queries.ts); errors show above the tabs, or in the invite dialog while it is open.
import { useMutationState, useQuery } from '@tanstack/solid-query'
import { useNavigate } from '@tanstack/solid-router'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { type Confirmation, ConfirmDialog } from '~/components/confirm-dialog'
import { PageTitle } from '~/components/page-title'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { errorMessage } from '~/lib/errors'
import { type Member, membersQuery } from '~/lib/members'
import { projectsQuery } from '~/lib/projects'
import { newId } from '~/lib/query'
import { type Team, teamsQuery } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { GeneralTab } from './general-tab'
import { InvitationsTab } from './invitations-tab'
import { InviteDialog, type InviteDialogState } from './invite-dialog'
import { MembersTab } from './members-tab'
import {
  type Invitation,
  type InviteInput,
  appUrlQuery,
  invitationLink,
  invitationsQuery,
  useAddTeamMember,
  useCancelInvitation,
  useCreateTeam,
  useDeleteTeam,
  useInviteMember,
  useRemoveMember,
  useRemoveTeamMember,
  useRenameOrganization,
  useRenameTeam,
  useSetTeamRole,
  useUpdateMemberRole,
} from './queries'
import { type OrgRole, type Viewer, grantableRoles } from './roles'
import type { OrganizationTab } from './search'
import { TeamDialog, type TeamDialogTarget } from './team-dialog'
import { TeamsTab } from './teams-tab'

const TABS = [
  { value: 'members', label: m.organization_tab_members },
  { value: 'invitations', label: m.organization_tab_invitations },
  { value: 'teams', label: m.organization_tab_teams },
  { value: 'general', label: m.organization_tab_general },
] as const satisfies readonly { value: OrganizationTab; label: () => string }[]

function list(names: string[]) {
  return new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(names)
}

export function OrganizationView(props: {
  organizationId: string
  organizationName: string
  slug: string
  viewer: Viewer
  zone: string
  tab: OrganizationTab
}) {
  const navigate = useNavigate()
  const members = useQuery(() => membersQuery(props.organizationId))
  const teams = useQuery(() => teamsQuery(props.organizationId))
  const projects = useQuery(() => projectsQuery(props.organizationId))
  const invitations = useQuery(() => invitationsQuery(props.organizationId))
  const appUrl = useQuery(() => appUrlQuery)

  // oxlint-disable-next-line solid/reactivity -- the page renders a new view per organization.
  const keys = { organizationId: props.organizationId, userId: props.viewer.userId }
  const updateMemberRole = useUpdateMemberRole(keys)
  const removeMember = useRemoveMember(keys)
  const inviteMember = useInviteMember(keys)
  const cancelInvitation = useCancelInvitation(keys)
  const createTeam = useCreateTeam(keys)
  const renameTeam = useRenameTeam(keys)
  const deleteTeam = useDeleteTeam(keys)
  const addTeamMember = useAddTeamMember(keys)
  const removeTeamMember = useRemoveTeamMember(keys)
  const setTeamRole = useSetTeamRole(keys)
  const renameOrganization = useRenameOrganization(keys)

  // Teams whose create awaits the server, so their stand-in id can't be acted on yet.
  const creating = useMutationState(() => ({
    filters: { mutationKey: ['create-team'], status: 'pending' },
    select: (mutation) => (mutation.state.variables as { id: string } | undefined)?.id,
  }))
  const pendingTeams = createMemo(() => new Set(creating().filter((id) => id !== undefined)))

  const [error, setError] = createSignal<string | null>(null)
  const [invite, setInvite] = createSignal<InviteDialogState | null>(null)
  const [teamDialog, setTeamDialog] = createSignal<TeamDialogTarget | null>(null)
  const [confirmation, setConfirmation] = createSignal<Confirmation | null>(null)

  function showError(e: unknown) {
    setError(errorMessage(e))
  }
  const options = { onError: showError }
  function run<T>(mutate: (input: T, opts: typeof options) => void, input: T) {
    setError(null)
    mutate(input, options)
  }

  function memberList() {
    return members.data ?? []
  }
  function teamList() {
    return teams.data ?? []
  }
  function invitationList() {
    return invitations.data ?? []
  }

  function setTab(tab: string) {
    void navigate({
      to: '/organization',
      search: tab === 'members' ? {} : { tab: tab as OrganizationTab },
      replace: true,
    })
  }

  function count(tab: OrganizationTab) {
    if (tab === 'members') return memberList().length
    if (tab === 'invitations') return invitationList().length
    if (tab === 'teams') return teamList().length
    return 0
  }

  // --- Members -------------------------------------------------------------------------

  function changeRole(member: Member, role: OrgRole) {
    run(updateMemberRole.mutate, { memberId: member.memberId, role })
  }

  function confirmRemove(member: Member) {
    setConfirmation({
      title: m.organization_remove_member_title({ name: member.name }),
      description: m.organization_remove_member_description({
        organization: props.organizationName,
      }),
      action: {
        label: m.organization_remove_member_confirm(),
        destructive: true,
        run: () => run(removeMember.mutate, { memberId: member.memberId, userId: member.userId }),
      },
    })
  }

  // --- Invitations ---------------------------------------------------------------------

  async function submitInvite(input: InviteInput) {
    const created = await inviteMember.mutateAsync(input)
    setInvite({ kind: 'link', invitation: created })
  }

  // An expired invitation gets a new one with the same address, role, and team.
  function renew(invitation: Invitation) {
    setError(null)
    setInvite({ kind: 'link', invitation: null })
    inviteMember.mutate(
      {
        email: invitation.email,
        role: invitation.role,
        teamId: invitation.teamId,
        replaces: invitation.id,
      },
      {
        onSuccess: (created) => setInvite({ kind: 'link', invitation: created }),
        onError: (e) => {
          setInvite(null)
          showError(e)
        },
      },
    )
  }

  async function copy(invitation: Invitation) {
    try {
      await navigator.clipboard.writeText(invitationLink(appUrl.data ?? '', invitation.id))
    } catch {
      // Clipboard access can be refused; "New link" and the dialog show the link to select.
    }
  }

  function confirmCancel(invitation: Invitation) {
    setConfirmation({
      title: m.organization_cancel_invitation_title(),
      description: m.organization_cancel_invitation_description({ email: invitation.email }),
      cancel: m.organization_cancel_invitation_keep(),
      action: {
        label: m.organization_cancel_invitation_confirm(),
        destructive: true,
        run: () => run(cancelInvitation.mutate, invitation),
      },
    })
  }

  // --- Teams ---------------------------------------------------------------------------

  function saveTeam(name: string) {
    const target = teamDialog()
    setTeamDialog(null)
    if (target?.kind === 'rename') run(renameTeam.mutate, { teamId: target.team.id, name })
    else run(createTeam.mutate, { id: newId(), name })
  }

  // Names the projects that lose the team, and those it leaves without teams, which then
  // open to the whole organization.
  function confirmDelete(team: Team) {
    const affected = (projects.data ?? []).filter((p) => p.teamIds.includes(team.id))
    const opened = affected.filter((p) => p.teamIds.length === 1)
    const description = [
      team.members.length
        ? m.organization_delete_team_members({ count: team.members.length })
        : m.organization_delete_team_empty(),
      affected.length
        ? m.organization_delete_team_projects({
            count: affected.length,
            projects: list(affected.map((p) => p.name)),
          })
        : '',
      opened.length
        ? m.organization_delete_team_opened({
            count: opened.length,
            projects: list(opened.map((p) => p.name)),
          })
        : '',
    ]
      .filter(Boolean)
      .join(' ')
    setConfirmation({
      title: m.organization_delete_team_title({ name: team.name }),
      description,
      action: {
        label: m.organization_team_delete(),
        destructive: true,
        run: () => run(deleteTeam.mutate, team.id),
      },
    })
  }

  // --- General -------------------------------------------------------------------------

  function renameOrg(name: string, done: () => void) {
    setError(null)
    renameOrganization.mutate(name, { onSuccess: done, onError: showError })
  }

  return (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div class="relative flex min-w-0 flex-col gap-1">
        <PageTitle title={m.nav_organization()} />
        <p class="scene-text text-muted-foreground min-w-0 truncate text-sm">
          {m.organization_subtitle({
            organization: props.organizationName,
            count: memberList().length,
          })}
        </p>
      </div>
      <Show when={error()}>
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>{error()}</AlertDescription>
        </Alert>
      </Show>
      <Tabs value={props.tab} onChange={setTab} class="grid min-w-0 gap-4">
        <div class="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList aria-label={m.organization_sections()}>
            <For each={TABS}>
              {(t) => (
                <TabsTrigger value={t.value}>
                  {t.label()}
                  <Show when={count(t.value)}>
                    {(n) => <span class="text-muted-foreground ml-1.5 text-xs">{n()}</span>}
                  </Show>
                </TabsTrigger>
              )}
            </For>
          </TabsList>
        </div>
        <TabsContent value="members" class="mt-0">
          <MembersTab
            members={memberList()}
            teams={teamList()}
            viewer={props.viewer}
            zone={props.zone}
            onInvite={() => setInvite({ kind: 'form' })}
            onRoleChange={changeRole}
            onRemove={confirmRemove}
          />
        </TabsContent>
        <TabsContent value="invitations" class="mt-0">
          <InvitationsTab
            invitations={invitationList()}
            members={memberList()}
            teams={teamList()}
            zone={props.zone}
            onInvite={() => setInvite({ kind: 'form' })}
            onCopy={copy}
            onRenew={renew}
            onCancel={confirmCancel}
          />
        </TabsContent>
        <TabsContent value="teams" class="mt-0">
          <TeamsTab
            teams={teamList()}
            members={memberList()}
            userId={props.viewer.userId}
            pending={pendingTeams()}
            onCreate={() => setTeamDialog({ kind: 'new' })}
            onRename={(team) => setTeamDialog({ kind: 'rename', team })}
            onDelete={confirmDelete}
            onAddMember={(team, userId) => run(addTeamMember.mutate, { teamId: team.id, userId })}
            onRemoveMember={(team, userId) =>
              run(removeTeamMember.mutate, { teamId: team.id, userId })
            }
            onTeamRole={(team, userId, role) =>
              run(setTeamRole.mutate, { teamId: team.id, userId, role })
            }
          />
        </TabsContent>
        <TabsContent value="general" class="mt-0">
          <GeneralTab name={props.organizationName} slug={props.slug} onRename={renameOrg} />
        </TabsContent>
      </Tabs>
      <InviteDialog
        state={invite()}
        members={memberList()}
        invitations={invitationList()}
        teams={teamList()}
        roles={grantableRoles(props.viewer)}
        appUrl={appUrl.data ?? ''}
        zone={props.zone}
        onSubmit={submitInvite}
        onClose={() => setInvite(null)}
      />
      <TeamDialog
        target={teamDialog()}
        teams={teamList()}
        onSave={saveTeam}
        onClose={() => setTeamDialog(null)}
      />
      <ConfirmDialog confirmation={confirmation()} onClose={() => setConfirmation(null)} />
    </div>
  )
}
