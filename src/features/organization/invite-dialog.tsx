// Inviting someone: an email, a role, and an optional team, then the link to send, because
// the MVP sends no email. Existing members and addresses with an open invitation are
// refused before Better Auth would; an address whose invitation expired gets a new one in
// its place. "New link" on an expired invitation opens the dialog at the link.
import { createForm } from '@tanstack/solid-form'
import CheckIcon from 'lucide-solid/icons/check'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import CopyIcon from 'lucide-solid/icons/copy'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js'
import * as v from 'valibot'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import { NativeSelect } from '~/components/ui/native-select'
import {
  TextField,
  TextFieldDescription,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field'
import { errorMessage } from '~/lib/errors'
import { fieldError } from '~/lib/form'
import { formatDateTime } from '~/lib/format'
import type { Member } from '~/lib/members'
import type { Team } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'
import { InvitationEmail } from '~/server/auth/auth.schemas'
import { type Invitation, type InviteInput, invitationLink, isExpired } from './queries'
import { type OrgRole, ROLE_LABELS } from './roles'

// The link to show, or null while the server creates it.
export interface CreatedInvitation {
  id: string
  email: string
  expiresAt: Date
}

export type InviteDialogState =
  | { kind: 'form' }
  | { kind: 'link'; invitation: CreatedInvitation | null }

export function InviteDialog(props: {
  state: InviteDialogState | null
  members: readonly Member[]
  invitations: readonly Invitation[]
  teams: readonly Team[]
  roles: readonly OrgRole[]
  appUrl: string
  zone: string
  onSubmit: (input: InviteInput) => Promise<void>
  onClose: () => void
}) {
  // The last state stays while the dialog animates closed.
  const shown = createMemo<InviteDialogState | null>((last) => props.state ?? last, null)
  return (
    <Dialog open={props.state !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent class="grid-cols-[minmax(0,1fr)]">
        <Show when={shown()?.kind === 'form'}>
          <InviteForm {...props} />
        </Show>
        <Show when={shown()?.kind === 'link' && shown()} keyed>
          {(state) => (
            <InviteLink
              invitation={state.kind === 'link' ? state.invitation : null}
              appUrl={props.appUrl}
              zone={props.zone}
              onClose={props.onClose}
            />
          )}
        </Show>
      </DialogContent>
    </Dialog>
  )
}

function InviteForm(props: {
  members: readonly Member[]
  invitations: readonly Invitation[]
  teams: readonly Team[]
  roles: readonly OrgRole[]
  onSubmit: (input: InviteInput) => Promise<void>
  onClose: () => void
}) {
  const [error, setError] = createSignal<string | null>(null)

  function emailError(value: string): string | undefined {
    const result = v.safeParse(InvitationEmail, value)
    if (!result.success) return result.issues[0].message
    const email = result.output
    if (props.members.some((mb) => mb.email.toLowerCase() === email)) {
      return m.organization_invite_already_member({ email })
    }
    if (props.invitations.some((i) => i.email.toLowerCase() === email && !isExpired(i))) {
      return m.organization_invite_already_invited({ email })
    }
    return undefined
  }

  const form = createForm(() => ({
    defaultValues: { email: '', role: 'member' as OrgRole, teamId: '' },
    onSubmitInvalid: () => queueMicrotask(() => document.getElementById('invite-email')?.focus()),
    onSubmit: async ({ value }) => {
      setError(null)
      const email = v.parse(InvitationEmail, value.email)
      const expired = props.invitations.find((i) => i.email.toLowerCase() === email)
      try {
        await props.onSubmit({
          email,
          role: value.role,
          teamId: value.teamId || null,
          replaces: expired?.id,
        })
      } catch (e) {
        setError(errorMessage(e))
      }
    },
  }))

  return (
    <form
      class="grid min-w-0 gap-4"
      novalidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{m.organization_invite()}</DialogTitle>
        <DialogDescription>{m.organization_invite_description()}</DialogDescription>
      </DialogHeader>
      <Show when={error()}>
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>{error()}</AlertDescription>
        </Alert>
      </Show>
      <form.Field name="email" validators={{ onSubmit: ({ value }) => emailError(value) }}>
        {(field) => (
          <TextField
            class="grid gap-2"
            value={field().state.value}
            onChange={field().handleChange}
            validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
          >
            <TextFieldLabel>{m.organization_invite_email()}</TextFieldLabel>
            <TextFieldInput
              id="invite-email"
              type="email"
              autocomplete="off"
              placeholder="name@example.com"
              onBlur={field().handleBlur}
            />
            <TextFieldDescription class="text-xs">
              {m.organization_invite_email_hint()}
            </TextFieldDescription>
            <TextFieldErrorMessage class="break-words">
              {fieldError(field().state.meta.errors)}
            </TextFieldErrorMessage>
          </TextField>
        )}
      </form.Field>
      <div class="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <form.Field name="role">
          {(field) => (
            <div class="grid gap-2">
              <Label for="invite-role">{m.organization_invite_role()}</Label>
              <NativeSelect
                id="invite-role"
                value={field().state.value}
                onChange={(event) => field().handleChange(event.currentTarget.value as OrgRole)}
              >
                <For each={props.roles}>
                  {(role) => (
                    <option value={role} selected={role === field().state.value}>
                      {ROLE_LABELS[role]()}
                    </option>
                  )}
                </For>
              </NativeSelect>
            </div>
          )}
        </form.Field>
        <form.Field name="teamId">
          {(field) => (
            <div class="grid gap-2">
              <Label for="invite-team">{m.organization_invite_team()}</Label>
              <NativeSelect
                id="invite-team"
                value={field().state.value}
                onChange={(event) => field().handleChange(event.currentTarget.value)}
              >
                <option value="" selected={field().state.value === ''}>
                  {m.organization_members_no_team()}
                </option>
                <For each={props.teams}>
                  {(team) => (
                    <option value={team.id} selected={team.id === field().state.value}>
                      {team.name}
                    </option>
                  )}
                </For>
              </NativeSelect>
            </div>
          )}
        </form.Field>
      </div>
      <DialogFooter class="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={() => props.onClose()}>
          {m.confirm_cancel()}
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting()}>
              {m.organization_invite_submit()}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}

function InviteLink(props: {
  invitation: CreatedInvitation | null
  appUrl: string
  zone: string
  onClose: () => void
}) {
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  function link() {
    return props.invitation ? invitationLink(props.appUrl, props.invitation.id) : ''
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link())
    } catch {
      // The link stays selectable in the field.
    }
    setCopied(true)
    clearTimeout(timer)
    timer = setTimeout(() => setCopied(false), 1500)
  }

  function description() {
    const invitation = props.invitation
    if (!invitation) return m.organization_invite_link_creating()
    const until = formatDateTime(invitation.expiresAt, props.zone, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    return m.organization_invite_link_description({ email: invitation.email, until })
  }

  return (
    <div class="grid min-w-0 gap-4">
      <DialogHeader>
        <DialogTitle>{m.organization_invite_link_title()}</DialogTitle>
        <DialogDescription class="break-words">{description()}</DialogDescription>
      </DialogHeader>
      <div class="flex min-w-0 gap-2">
        <TextField class="min-w-0 flex-1" value={link()}>
          <TextFieldLabel class="sr-only">{m.organization_invite_link()}</TextFieldLabel>
          <TextFieldInput
            readOnly
            class="min-w-0 font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
        </TextField>
        <Button
          variant="outline"
          class="shrink-0"
          disabled={!props.invitation}
          onClick={() => void copy()}
        >
          <Show
            when={props.invitation}
            fallback={<LoaderCircleIcon class="animate-spin" aria-hidden="true" />}
          >
            <Show when={copied()} fallback={<CopyIcon aria-hidden="true" />}>
              <CheckIcon aria-hidden="true" />
            </Show>
          </Show>
          {copied() ? m.organization_copied() : m.organization_copy()}
        </Button>
      </div>
      <DialogFooter>
        <Button onClick={() => props.onClose()}>{m.organization_done()}</Button>
      </DialogFooter>
    </div>
  )
}
