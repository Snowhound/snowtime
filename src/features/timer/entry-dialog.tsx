// The entry dialog (prototypes/timer.html): edits the running entry's start, or logs a
// past entry by hand. Stopped entries are edited in their rows (entry-fields.tsx). Times are read in the user's zone; an end at or
// before the start means the next day, and a live line shows the resulting duration.
import { createForm } from '@tanstack/solid-form'
import { Show, createMemo } from 'solid-js'
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
import { TextField, TextFieldInput, TextFieldLabel } from '~/components/ui/text-field'
import { localDate, localTime } from '~/lib/calendar'
import { formatHours } from '~/lib/format'
import type { Project } from '~/lib/projects'
import { m } from '~/paraglide/messages.js'
import { type EntryFormError, readEntryTimes } from './entries'
import { ProjectSelect } from './project-select'
import type { Entry } from './queries'

export type EntryDialogTarget = { kind: 'new' } | { kind: 'running'; entry: Entry }

export interface EntryDialogValues {
  description: string
  projectId: string | null
  startedAt: Date
  // Null for the running entry.
  stoppedAt: Date | null
}

const ERRORS: Record<EntryFormError, () => string> = {
  missing: m.entry_error_missing,
  missing_running: m.entry_error_missing_running,
  future: m.entry_error_future,
  running_future: m.entry_error_running_future,
}

const TITLES = {
  new: m.entry_dialog_new,
  running: m.entry_dialog_edit_running,
} as const

export function EntryDialog(props: {
  target: EntryDialogTarget | null
  zone: string
  projects: readonly Project[]
  onSave: (values: EntryDialogValues) => void
  onClose: () => void
}) {
  // The last target stays while the dialog animates closed.
  const shown = createMemo<EntryDialogTarget | null>((last) => props.target ?? last, null)
  return (
    <Dialog open={props.target !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent>
        <Show when={shown()} keyed>
          {(target) => (
            <EntryForm
              target={target}
              zone={props.zone}
              projects={props.projects}
              onSave={props.onSave}
              onClose={props.onClose}
            />
          )}
        </Show>
      </DialogContent>
    </Dialog>
  )
}

function EntryForm(props: {
  target: EntryDialogTarget
  zone: string
  projects: readonly Project[]
  onSave: (values: EntryDialogValues) => void
  onClose: () => void
}) {
  // oxlint-disable-next-line solid/reactivity -- the form starts from the target it opened with.
  const target = props.target
  const entry = target.kind === 'new' ? null : target.entry
  const running = target.kind === 'running'

  const form = createForm(() => ({
    defaultValues: {
      description: entry?.description ?? '',
      projectId: entry?.projectId ?? '',
      date: localDate(entry?.startedAt.getTime() ?? Date.now(), props.zone),
      start: entry ? localTime(entry.startedAt.getTime(), props.zone) : '',
      end: entry?.stoppedAt ? localTime(entry.stoppedAt.getTime(), props.zone) : '',
    },
    onSubmit: ({ value }) => {
      const times = readEntryTimes(value, {
        running,
        zone: props.zone,
        original: entry ?? undefined,
      })
      if (times.error) return
      props.onSave({
        description: value.description.trim(),
        projectId: value.projectId || null,
        startedAt: times.startedAt,
        stoppedAt: times.stoppedAt,
      })
    },
  }))
  const times = form.useStore((state) =>
    readEntryTimes(state.values, { running, zone: props.zone, original: entry ?? undefined }),
  )
  // Like the prototype, the error shows once saving was tried, then follows the input.
  const error = form.useStore((state) => {
    const result = readEntryTimes(state.values, {
      running,
      zone: props.zone,
      original: entry ?? undefined,
    })
    return state.submissionAttempts > 0 && result.error ? ERRORS[result.error]() : null
  })

  function summary() {
    const result = times()
    if (result.error) return ''
    if (!result.stoppedAt) {
      return m.entry_running_for({ duration: formatHours(Date.now() - result.startedAt.getTime()) })
    }
    const duration = formatHours(result.stoppedAt.getTime() - result.startedAt.getTime())
    return result.nextDay ? m.entry_duration_next_day({ duration }) : m.entry_duration({ duration })
  }

  return (
    <form
      class="grid gap-4"
      novalidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{TITLES[target.kind]()}</DialogTitle>
        <DialogDescription>
          {m.entry_dialog_zone({ zone: props.zone.replaceAll('_', ' ') })}
        </DialogDescription>
      </DialogHeader>
      <div class="grid gap-4">
        <form.Field name="description">
          {(field) => (
            <TextField
              class="grid gap-1.5"
              value={field().state.value}
              onChange={field().handleChange}
            >
              <TextFieldLabel>{m.entry_description()}</TextFieldLabel>
              <TextFieldInput autocomplete="off" placeholder={m.entry_description_placeholder()} />
            </TextField>
          )}
        </form.Field>
        <form.Field name="projectId">
          {(field) => (
            <div class="grid gap-1.5">
              <Label for="entry-project">{m.timer_project()}</Label>
              <ProjectSelect
                id="entry-project"
                projects={props.projects}
                value={field().state.value}
                onChange={field().handleChange}
              />
            </div>
          )}
        </form.Field>
        <div class="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
          <form.Field name="date">
            {(field) => (
              <TextField
                class="grid gap-1.5"
                value={field().state.value}
                onChange={field().handleChange}
                validationState={error() ? 'invalid' : 'valid'}
                required
              >
                <TextFieldLabel>{m.entry_date()}</TextFieldLabel>
                <TextFieldInput type="date" />
              </TextField>
            )}
          </form.Field>
          <form.Field name="start">
            {(field) => (
              <TextField
                class="grid gap-1.5"
                value={field().state.value}
                onChange={field().handleChange}
                validationState={error() ? 'invalid' : 'valid'}
                required
              >
                <TextFieldLabel>{m.entry_start()}</TextFieldLabel>
                <TextFieldInput type="time" />
              </TextField>
            )}
          </form.Field>
          <Show when={!running}>
            <form.Field name="end">
              {(field) => (
                <TextField
                  class="grid gap-1.5"
                  value={field().state.value}
                  onChange={field().handleChange}
                  validationState={error() ? 'invalid' : 'valid'}
                  required
                >
                  <TextFieldLabel>{m.entry_end()}</TextFieldLabel>
                  <TextFieldInput type="time" />
                </TextField>
              )}
            </form.Field>
          </Show>
        </div>
        <p class="text-muted-foreground text-sm" aria-live="polite">
          {summary()}
        </p>
        <Show when={error()}>
          <p role="alert" class="text-destructive text-xs font-medium">
            {error()}
          </p>
        </Show>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => props.onClose()}>
          {m.entry_cancel()}
        </Button>
        <Button type="submit">{m.entry_save()}</Button>
      </DialogFooter>
    </form>
  )
}
