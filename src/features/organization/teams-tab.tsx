// The Teams tab: a card per team with its leads, a Lead or Member select per person
// (setTeamRole), remove, add a member, rename, and delete.
import EllipsisIcon from 'lucide-solid/icons/ellipsis'
import PencilIcon from 'lucide-solid/icons/pencil'
import PlusIcon from 'lucide-solid/icons/plus'
import TrashIcon from 'lucide-solid/icons/trash'
import UsersIcon from 'lucide-solid/icons/users'
import XIcon from 'lucide-solid/icons/x'
import { For, Show, createSignal } from 'solid-js'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { NativeSelect } from '~/components/ui/native-select'
import type { Member } from '~/lib/members'
import type { Team } from '~/lib/teams'
import { initials } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { TEAM_ROLES } from '~/server/teams/teams.schemas'

type TeamRole = (typeof TEAM_ROLES)[number]

const TEAM_ROLE_LABELS = {
  lead: m.organization_team_role_lead,
  member: m.organization_team_role_member,
} satisfies Record<TeamRole, () => string>

export interface TeamActions {
  onCreate: () => void
  onRename: (team: Team) => void
  onDelete: (team: Team) => void
  onAddMember: (team: Team, userId: string) => void
  onRemoveMember: (team: Team, userId: string) => void
  onTeamRole: (team: Team, userId: string, role: TeamRole) => void
}

export function TeamsTab(
  props: TeamActions & {
    teams: readonly Team[]
    members: readonly Member[]
    userId: string
    // Teams Better Auth is still creating, which have no id to act on yet.
    pending: ReadonlySet<string>
  },
) {
  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-muted-foreground max-w-2xl text-sm">{m.organization_teams_intro()}</p>
        <Button size="sm" class="shrink-0 self-start" onClick={() => props.onCreate()}>
          <PlusIcon aria-hidden="true" />
          {m.organization_team_create()}
        </Button>
      </div>
      <div class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <For
          each={props.teams}
          fallback={
            <div class="surface bg-background col-span-full flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
              <UsersIcon class="text-muted-foreground size-6" aria-hidden="true" />
              <p class="font-medium">{m.organization_teams_empty_title()}</p>
              <p class="text-muted-foreground max-w-md text-sm">
                {m.organization_teams_empty_description()}
              </p>
            </div>
          }
        >
          {(team) => <TeamCard {...props} team={team} pending={props.pending.has(team.id)} />}
        </For>
      </div>
    </div>
  )
}

function TeamCard(
  props: TeamActions & {
    team: Team
    members: readonly Member[]
    userId: string
    pending: boolean
  },
) {
  const [adding, setAdding] = createSignal('')
  function titleId() {
    return `team-${props.team.id}-title`
  }

  function member(userId: string) {
    return props.members.find((mb) => mb.userId === userId)
  }
  // Leads first, then by name; people no longer listed are skipped. The rows are the team's
  // own member entries, which the reconciled cache keeps in place, so a row changed through
  // its select stays mounted and focused.
  function rows() {
    const names = new Map(props.members.map((mb) => [mb.userId, mb.name]))
    return props.team.members
      .filter((tm) => names.has(tm.userId))
      .sort((a, b) =>
        a.role === b.role
          ? names.get(a.userId)!.localeCompare(names.get(b.userId)!)
          : a.role === 'lead'
            ? -1
            : 1,
      )
  }
  function outside() {
    return props.members.filter((mb) => !props.team.members.some((tm) => tm.userId === mb.userId))
  }
  function summary() {
    const count = props.team.members.length
    const leads = rows()
      .filter((tm) => tm.role === 'lead')
      .map((tm) => member(tm.userId)!.name)
    const lead = leads.length
      ? m.organization_team_led_by({
          names: new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(leads),
        })
      : m.organization_team_no_lead()
    return `${m.organization_team_members({ count })} · ${lead}`
  }

  function add(event: SubmitEvent) {
    event.preventDefault()
    const userId = adding()
    if (!userId) return
    setAdding('')
    props.onAddMember(props.team, userId)
  }

  return (
    // Card's classes on a section, so each team is a labelled region.
    <section
      class="surface bg-card text-card-foreground min-w-0 rounded-lg border shadow-sm"
      aria-labelledby={titleId()}
    >
      <header class="flex items-start justify-between gap-3 p-4 pb-3 sm:p-6 sm:pb-3">
        <div class="min-w-0">
          <h2 id={titleId()} class="leading-tight font-semibold break-words">
            {props.team.name}
          </h2>
          <p class="text-muted-foreground mt-1 text-sm">{summary()}</p>
        </div>
        <DropdownMenu placement="bottom-end">
          <DropdownMenuTrigger
            as={Button<'button'>}
            variant="ghost"
            size="icon"
            class="size-9 shrink-0"
            disabled={props.pending}
            aria-label={m.organization_team_actions({ name: props.team.name })}
          >
            <EllipsisIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-44">
            <DropdownMenuItem class="gap-2" onSelect={() => props.onRename(props.team)}>
              <PencilIcon class="size-4" aria-hidden="true" />
              {m.organization_team_rename()}
            </DropdownMenuItem>
            <DropdownMenuItem
              class="text-destructive focus:text-destructive gap-2"
              onSelect={() => props.onDelete(props.team)}
            >
              <TrashIcon class="size-4" aria-hidden="true" />
              {m.organization_team_delete()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <ul class="divide-y border-y">
        <For
          each={rows()}
          fallback={
            <li class="text-muted-foreground px-6 py-4 text-sm">
              {m.organization_team_no_members()}
            </li>
          }
        >
          {(teamMember) => {
            const row = {
              get member() {
                return member(teamMember.userId)!
              },
              get role() {
                return teamMember.role
              },
            }
            function selectId() {
              return `team-role-${props.team.id}-${row.member.userId}`
            }
            return (
              <li class="flex items-center gap-3 px-4 py-2 sm:px-6">
                <Avatar class="size-8">
                  <Show when={row.member.image}>
                    {(image) => <AvatarImage src={image()} alt="" />}
                  </Show>
                  <AvatarFallback class="text-[11px] font-medium">
                    {initials(row.member.name)}
                  </AvatarFallback>
                </Avatar>
                <span class="min-w-0 flex-1 truncate text-sm">
                  {row.member.name}
                  <Show when={row.member.userId === props.userId}>
                    {' '}
                    <span class="text-muted-foreground">{m.organization_you()}</span>
                  </Show>
                </span>
                <label class="sr-only" for={selectId()}>
                  {m.organization_team_role_label({ name: row.member.name })}
                </label>
                <div class="w-28 shrink-0">
                  <NativeSelect
                    id={selectId()}
                    class="h-8 text-xs"
                    value={row.role}
                    disabled={props.pending}
                    onChange={(event) =>
                      props.onTeamRole(
                        props.team,
                        row.member.userId,
                        event.currentTarget.value as TeamRole,
                      )
                    }
                  >
                    <For each={TEAM_ROLES}>
                      {(role) => (
                        <option value={role} selected={role === row.role}>
                          {TEAM_ROLE_LABELS[role]()}
                        </option>
                      )}
                    </For>
                  </NativeSelect>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8 shrink-0"
                  disabled={props.pending}
                  aria-label={m.organization_team_remove_member({
                    name: row.member.name,
                    team: props.team.name,
                  })}
                  onClick={() => props.onRemoveMember(props.team, row.member.userId)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </li>
            )
          }}
        </For>
      </ul>
      <form class="flex gap-2 p-4 sm:px-6" onSubmit={add}>
        <label class="sr-only" for={`team-add-${props.team.id}`}>
          {m.organization_team_add_label({ team: props.team.name })}
        </label>
        <div class="min-w-0 flex-1">
          <NativeSelect
            id={`team-add-${props.team.id}`}
            class="h-9"
            value={adding()}
            disabled={props.pending || outside().length === 0}
            onChange={(event) => setAdding(event.currentTarget.value)}
          >
            <Show
              when={outside().length}
              fallback={<option value="">{m.organization_team_everyone_added()}</option>}
            >
              <option value="" selected={adding() === ''}>
                {m.organization_team_add_placeholder()}
              </option>
              <For each={outside()}>
                {(mb) => (
                  <option value={mb.userId} selected={mb.userId === adding()}>
                    {mb.name}
                  </option>
                )}
              </For>
            </Show>
          </NativeSelect>
        </div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          class="h-9 shrink-0"
          disabled={props.pending || outside().length === 0}
        >
          {m.organization_team_add()}
        </Button>
      </form>
    </section>
  )
}
