// Creating or renaming a team. Names are trimmed and unique within the organization,
// ignoring case; Better Auth doesn't check, so the dialog does.
import { createForm } from '@tanstack/solid-form'
import { Show, createMemo } from 'solid-js'
import * as v from 'valibot'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  TextField,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field'
import { fieldError } from '~/lib/form'
import type { Team } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'
import { Name } from '~/server/auth/auth.schemas'

export type TeamDialogTarget = { kind: 'new' } | { kind: 'rename'; team: Team }

export function TeamDialog(props: {
  target: TeamDialogTarget | null
  teams: readonly Team[]
  onSave: (name: string) => void
  onClose: () => void
}) {
  // The last target stays while the dialog animates closed.
  const shown = createMemo<TeamDialogTarget | null>((last) => props.target ?? last, null)
  return (
    <Dialog open={props.target !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent class="grid-cols-[minmax(0,1fr)]">
        <Show when={shown()} keyed>
          {(target) => (
            <TeamForm
              target={target}
              teams={props.teams}
              onSave={props.onSave}
              onClose={props.onClose}
            />
          )}
        </Show>
      </DialogContent>
    </Dialog>
  )
}

function TeamForm(props: {
  target: TeamDialogTarget
  teams: readonly Team[]
  onSave: (name: string) => void
  onClose: () => void
}) {
  // oxlint-disable-next-line solid/reactivity -- the form starts from the target it opened with.
  const team = props.target.kind === 'rename' ? props.target.team : null

  function nameError(value: string): string | undefined {
    const result = v.safeParse(Name, value)
    if (!result.success) return result.issues[0].message
    const name = result.output
    const lower = name.toLowerCase()
    const clash = props.teams.some((t) => t.id !== team?.id && t.name.toLowerCase() === lower)
    return clash ? m.organization_team_name_taken({ name }) : undefined
  }

  const form = createForm(() => ({
    defaultValues: { name: team?.name ?? '' },
    onSubmitInvalid: () => queueMicrotask(() => document.getElementById('team-name')?.focus()),
    onSubmit: ({ value }) => {
      const name = value.name.trim()
      if (name === team?.name) props.onClose()
      else props.onSave(name)
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
        <DialogTitle>
          {team ? m.organization_team_rename_title() : m.organization_team_create()}
        </DialogTitle>
      </DialogHeader>
      <form.Field name="name" validators={{ onSubmit: ({ value }) => nameError(value) }}>
        {(field) => (
          <TextField
            class="grid gap-2"
            value={field().state.value}
            onChange={field().handleChange}
            validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
          >
            <TextFieldLabel>{m.organization_name()}</TextFieldLabel>
            <TextFieldInput
              id="team-name"
              autocomplete="off"
              maxLength={100}
              onBlur={field().handleBlur}
            />
            <TextFieldErrorMessage class="break-words">
              {fieldError(field().state.meta.errors)}
            </TextFieldErrorMessage>
          </TextField>
        )}
      </form.Field>
      <DialogFooter class="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={() => props.onClose()}>
          {m.confirm_cancel()}
        </Button>
        <Button type="submit">{team ? m.organization_save() : m.organization_team_create()}</Button>
      </DialogFooter>
    </form>
  )
}
