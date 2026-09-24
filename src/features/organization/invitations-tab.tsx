// The Invitations tab: open invitations with their role, team, inviter, and time left.
// Snowtime sends no email, so each gets a link to copy; an expired one gets a new link
// instead, and any can be canceled.
import CheckIcon from 'lucide-solid/icons/check'
import CopyIcon from 'lucide-solid/icons/copy'
import LinkIcon from 'lucide-solid/icons/link'
import MailIcon from 'lucide-solid/icons/mail'
import UserPlusIcon from 'lucide-solid/icons/user-plus'
import { For, Show, createSignal, onCleanup } from 'solid-js'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { formatDateTime } from '~/lib/format'
import type { Member } from '~/lib/members'
import type { Team } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'
import { type Invitation, isExpired } from './queries'
import { ROLE_LABELS } from './roles'

const HOUR = 3_600_000

export interface InvitationActions {
  onInvite: () => void
  onCopy: (invitation: Invitation) => Promise<void>
  onRenew: (invitation: Invitation) => void
  onCancel: (invitation: Invitation) => void
}

export function InvitationsTab(
  props: InvitationActions & {
    invitations: readonly Invitation[]
    members: readonly Member[]
    teams: readonly Team[]
    zone: string
  },
) {
  function sorted() {
    return [...props.invitations].sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())
  }

  return (
    <Card class="min-w-0">
      <div class="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6 sm:pb-4">
        <p class="text-muted-foreground max-w-xl text-sm">{m.organization_invitations_intro()}</p>
        <Button size="sm" class="shrink-0 self-start" onClick={() => props.onInvite()}>
          <UserPlusIcon aria-hidden="true" />
          {m.organization_invite()}
        </Button>
      </div>
      <ul class="divide-y border-t">
        <For
          each={sorted()}
          fallback={
            <li class="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <MailIcon class="text-muted-foreground size-6" aria-hidden="true" />
              <p class="font-medium">{m.organization_invitations_empty_title()}</p>
              <p class="text-muted-foreground text-sm">
                {m.organization_invitations_empty_description()}
              </p>
            </li>
          }
        >
          {(invitation) => <InvitationRow {...props} invitation={invitation} />}
        </For>
      </ul>
    </Card>
  )
}

function InvitationRow(
  props: InvitationActions & {
    invitation: Invitation
    members: readonly Member[]
    teams: readonly Team[]
    zone: string
  },
) {
  function expired() {
    return isExpired(props.invitation)
  }
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  async function copy() {
    await props.onCopy(props.invitation)
    setCopied(true)
    clearTimeout(timer)
    timer = setTimeout(() => setCopied(false), 1500)
  }

  function expiry() {
    const left = props.invitation.expiresAt.getTime() - Date.now()
    if (left <= 0) {
      const date = formatDateTime(props.invitation.expiresAt, props.zone, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
      return m.organization_invitation_expired_on({ date })
    }
    const hours = Math.floor(left / HOUR)
    return hours >= 1
      ? m.organization_invitation_expires_in({ count: hours })
      : m.organization_invitation_expires_soon()
  }

  function details() {
    const team = props.teams.find((t) => t.id === props.invitation.teamId)
    const inviter = props.members.find((mb) => mb.userId === props.invitation.inviterId)
    return [
      ROLE_LABELS[props.invitation.role]?.() ?? props.invitation.role,
      team?.name,
      inviter
        ? m.organization_invitation_invited_by({ name: inviter.name })
        : m.organization_invitation_invited_by_former(),
      expiry(),
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return (
    <li class="flex flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center">
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
          <span class="min-w-0 truncate">{props.invitation.email}</span>
          <Show when={expired()}>
            <Badge variant="outline">{m.organization_invitation_expired()}</Badge>
          </Show>
        </div>
        <p class="text-muted-foreground truncate text-sm">{details()}</p>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <Show
          when={expired()}
          fallback={
            <Button
              variant="outline"
              size="sm"
              aria-label={
                copied()
                  ? m.organization_copied()
                  : m.organization_invitation_copy_label({ email: props.invitation.email })
              }
              onClick={() => void copy()}
            >
              <Show when={copied()} fallback={<CopyIcon aria-hidden="true" />}>
                <CheckIcon aria-hidden="true" />
              </Show>
              {copied() ? m.organization_copied() : m.organization_invitation_copy()}
            </Button>
          }
        >
          <Button
            variant="outline"
            size="sm"
            aria-label={m.organization_invitation_renew_label({ email: props.invitation.email })}
            onClick={() => props.onRenew(props.invitation)}
          >
            <LinkIcon aria-hidden="true" />
            {m.organization_invitation_renew()}
          </Button>
        </Show>
        <Button
          variant="ghost"
          size="sm"
          aria-label={m.organization_invitation_cancel_label({ email: props.invitation.email })}
          onClick={() => props.onCancel(props.invitation)}
        >
          {m.organization_invitation_cancel()}
        </Button>
      </div>
    </li>
  )
}
