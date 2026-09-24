// The Members tab: a name or email search, each member's teams (with "Lead"), their role,
// and remove. Rows the viewer can't change show the role as a badge that says why
// (roles.ts); their remove button is disabled.
import SearchIcon from 'lucide-solid/icons/search'
import UserMinusIcon from 'lucide-solid/icons/user-minus'
import UserPlusIcon from 'lucide-solid/icons/user-plus'
import { For, Show, createSignal } from 'solid-js'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { NativeSelect } from '~/components/ui/native-select'
import { TextField, TextFieldInput, TextFieldLabel } from '~/components/ui/text-field'
import { formatDateTime } from '~/lib/format'
import type { Member } from '~/lib/members'
import type { Team } from '~/lib/teams'
import { initials } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import {
  type MemberLock,
  type OrgRole,
  ROLE_LABELS,
  type Viewer,
  byRoleAndName,
  memberLock,
  roleOptions,
} from './roles'

const LOCK_REASONS = {
  last_owner: m.organization_lock_last_owner,
  self: m.organization_lock_self,
  owner: m.organization_lock_owner,
} satisfies Record<MemberLock, () => string>

export interface MemberActions {
  onInvite: () => void
  onRoleChange: (member: Member, role: OrgRole) => void
  onRemove: (member: Member) => void
}

export function MembersTab(
  props: MemberActions & {
    members: readonly Member[]
    teams: readonly Team[]
    viewer: Viewer
    zone: string
  },
) {
  const [query, setQuery] = createSignal('')

  function shown() {
    const q = query().trim().toLowerCase()
    return props.members
      .filter((mb) => !q || mb.name.toLowerCase().includes(q) || mb.email.toLowerCase().includes(q))
      .sort(byRoleAndName)
  }

  return (
    <>
      <Card class="min-w-0">
        <div class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6 sm:pb-4">
          <TextField class="relative min-w-0 sm:w-72" value={query()} onChange={setQuery}>
            <TextFieldLabel class="sr-only">{m.organization_members_search()}</TextFieldLabel>
            <SearchIcon
              class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <TextFieldInput
              type="search"
              class="h-9 pl-9"
              placeholder={m.organization_members_search_placeholder()}
              autocomplete="off"
            />
          </TextField>
          <Button size="sm" class="self-start sm:self-auto" onClick={() => props.onInvite()}>
            <UserPlusIcon aria-hidden="true" />
            {m.organization_invite()}
          </Button>
        </div>
        <ul class="divide-y border-t">
          <For
            each={shown()}
            fallback={
              <li class="text-muted-foreground px-6 py-10 text-center text-sm break-words">
                {m.organization_members_no_match({ query: query() })}
              </li>
            }
          >
            {(member) => <MemberRow {...props} member={member} />}
          </For>
        </ul>
      </Card>
      <p class="page-note text-muted-foreground mt-3 text-sm">
        {m.organization_members_footnote()}
      </p>
    </>
  )
}

function MemberRow(
  props: MemberActions & {
    member: Member
    members: readonly Member[]
    teams: readonly Team[]
    viewer: Viewer
    zone: string
  },
) {
  function lock() {
    return memberLock(props.viewer, props.member, props.members)
  }
  function you() {
    return props.member.userId === props.viewer.userId
  }
  function teams() {
    return props.member.teams.flatMap((mt) => {
      const team = props.teams.find((t) => t.id === mt.teamId)
      return team ? [{ team, lead: mt.role === 'lead' }] : []
    })
  }
  function selectId() {
    return `role-${props.member.userId}`
  }

  return (
    <li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8rem_2.5rem] xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8rem_9rem]">
      <div class="flex min-w-0 items-center gap-3">
        <Avatar class="size-9">
          <Show when={props.member.image}>{(image) => <AvatarImage src={image()} alt="" />}</Show>
          <AvatarFallback class="text-xs font-medium">{initials(props.member.name)}</AvatarFallback>
        </Avatar>
        <div class="min-w-0">
          <p class="truncate text-sm font-medium">
            {props.member.name}
            <Show when={you()}>
              {' '}
              <span class="text-muted-foreground font-normal">{m.organization_you()}</span>
            </Show>
          </p>
          <p class="text-muted-foreground truncate text-sm">{props.member.email}</p>
        </div>
      </div>
      <div class="col-span-2 row-start-2 flex min-w-0 flex-wrap gap-1.5 md:col-span-1 md:row-start-auto">
        <For
          each={teams()}
          fallback={
            <span class="text-muted-foreground text-sm">{m.organization_members_no_team()}</span>
          }
        >
          {({ team, lead }) => (
            <Badge variant="outline" class="max-w-full gap-1 font-normal">
              <span class="truncate">{team.name}</span>
              <Show when={lead}>
                <span class="text-muted-foreground">· {m.organization_team_role_lead()}</span>
              </Show>
            </Badge>
          )}
        </For>
      </div>
      <div class="flex items-center gap-2">
        <Show
          when={!lock()}
          fallback={
            <Badge
              variant={props.member.orgRole === 'member' ? 'outline' : 'secondary'}
              title={LOCK_REASONS[lock()!]()}
            >
              {ROLE_LABELS[props.member.orgRole]()}
              <span class="sr-only">. {LOCK_REASONS[lock()!]()}</span>
            </Badge>
          }
        >
          <label class="sr-only" for={selectId()}>
            {m.organization_member_role_label({ name: props.member.name })}
          </label>
          <NativeSelect
            id={selectId()}
            class="h-9 w-32"
            value={props.member.orgRole}
            onChange={(event) =>
              props.onRoleChange(props.member, event.currentTarget.value as OrgRole)
            }
          >
            <For each={roleOptions(props.viewer, props.member)}>
              {(role) => (
                <option value={role} selected={role === props.member.orgRole}>
                  {ROLE_LABELS[role]()}
                </option>
              )}
            </For>
          </NativeSelect>
        </Show>
      </div>
      <div class="col-start-2 row-start-1 flex items-center justify-end gap-1 md:col-start-auto md:row-start-auto">
        <span class="text-muted-foreground hidden w-24 text-right text-xs xl:inline">
          {formatDateTime(new Date(props.member.joinedAt), props.zone, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          class="size-9"
          disabled={lock() !== null}
          aria-label={m.organization_member_remove_label({ name: props.member.name })}
          onClick={() => props.onRemove(props.member)}
        >
          <UserMinusIcon aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}
