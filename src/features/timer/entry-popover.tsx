// The entry popover (prototypes/timer.html): logs a past entry by hand under Add entry, or
// edits the running entry's start under the timer's clock. Stopped entries are edited in
// their rows (entry-fields.tsx). Times are read in the user's zone; an end at or before the
// start means the next day, and a live line shows the resulting duration. Escape and a click
// outside keep what was typed into a new entry for the next Add entry; Cancel and Save
// clear it.
import { createForm } from '@tanstack/solid-form'
import { Show, createMemo, createSignal } from 'solid-js'
import { DatePicker } from '~/components/date-time/date-picker'
import { TimeInput } from '~/components/date-time/time-input'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { Popover, PopoverContent } from '~/components/ui/popover'
import { type IsoDate, type WeekStart, localDate, localTime } from '~/lib/calendar'
import { useFormatHours } from '~/lib/display-format'
import type { Project } from '~/lib/projects'
import { m } from '~/paraglide/messages.js'
import { DescriptionCombobox } from './description-combobox'
import { type EntryFormError, lastEndToday, readEntryTimes } from './entries'
import { ProjectSelect } from './project-select'
import type { Entry } from './queries'

export type EntryPopoverTarget = { kind: 'new' } | { kind: 'running'; entry: Entry }

export interface EntryPopoverValues {
  description: string
  projectId: string | null
  startedAt: Date
  // Null for the running entry.
  stoppedAt: Date | null
}

interface FormValues {
  description: string
  projectId: string
  date: IsoDate
  start: string
  end: string
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

export function EntryPopover(props: {
  target: EntryPopoverTarget | null
  // The button the popover opens under.
  anchor: HTMLElement | undefined
  zone: string
  weekStart: WeekStart
  projects: readonly Project[]
  // Stopped entries, for the description's suggestions and a new entry's start.
  entries: readonly Entry[]
  onSave: (values: EntryPopoverValues) => void
  onClose: () => void
}) {
  // The last target and anchor stay while the popover animates closed.
  const shown = createMemo<EntryPopoverTarget | null>((last) => props.target ?? last, null)
  const anchor = createMemo<HTMLElement | undefined>((last) => props.anchor ?? last)
  const [draft, setDraft] = createSignal<FormValues | null>(null)
  let readValues: (() => FormValues) | undefined
  // Kobalte returns focus to a trigger, which this popover doesn't have; it goes back to the
  // anchor unless a click outside took it elsewhere.
  let interactedOutside = false

  function dismiss() {
    if (shown()?.kind === 'new' && readValues) setDraft(readValues())
    props.onClose()
  }

  return (
    <Popover
      open={props.target !== null}
      onOpenChange={(open) => !open && dismiss()}
      anchorRef={anchor}
      placement={shown()?.kind === 'running' ? 'bottom-start' : 'bottom-end'}
    >
      <PopoverContent
        class="w-[28rem] max-w-[calc(100vw-1rem)]"
        aria-labelledby="entry-popover-title"
        aria-describedby="entry-popover-description"
        // The buttons that open the popover carry data-entry-trigger, so a click on one while
        // it is open switches or closes it instead of counting as a click outside.
        onInteractOutside={(event: Event) => {
          if ((event.target as Element | null)?.closest('[data-entry-trigger]')) {
            event.preventDefault()
          } else interactedOutside = true
        }}
        // The running entry opens at its start, a new one at its description.
        onOpenAutoFocus={(event: Event) => {
          event.preventDefault()
          const content = event.currentTarget as HTMLElement
          const field = shown()?.kind === 'running' ? '#entry-start' : '[role="combobox"]'
          content.querySelector<HTMLElement>(field)?.focus()
        }}
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault()
          if (!interactedOutside) anchor()?.focus()
          interactedOutside = false
        }}
      >
        <Show when={shown()} keyed>
          {(target) => (
            <EntryForm
              target={target}
              draft={target.kind === 'new' ? draft() : null}
              zone={props.zone}
              weekStart={props.weekStart}
              projects={props.projects}
              entries={props.entries}
              readValues={(read) => (readValues = read)}
              onSave={(values) => {
                setDraft(null)
                props.onSave(values)
              }}
              onCancel={() => {
                setDraft(null)
                props.onClose()
              }}
            />
          )}
        </Show>
      </PopoverContent>
    </Popover>
  )
}

function EntryForm(props: {
  target: EntryPopoverTarget
  draft: FormValues | null
  zone: string
  weekStart: WeekStart
  projects: readonly Project[]
  entries: readonly Entry[]
  readValues: (read: () => FormValues) => void
  onSave: (values: EntryPopoverValues) => void
  onCancel: () => void
}) {
  const formatHours = useFormatHours()
  // oxlint-disable-next-line solid/reactivity -- the form starts from the target it opened with.
  const target = props.target
  const entry = target.kind === 'new' ? null : target.entry
  const running = target.kind === 'running'
  // oxlint-disable-next-line solid/reactivity -- the latest day to pick, as of opening.
  const today = localDate(Date.now(), props.zone)

  const form = createForm(() => ({
    defaultValues: props.draft ?? {
      description: entry?.description ?? '',
      projectId: entry?.projectId ?? '',
      date: localDate(entry?.startedAt.getTime() ?? Date.now(), props.zone),
      start: entry
        ? localTime(entry.startedAt.getTime(), props.zone)
        : lastEndToday(props.entries, props.zone),
      end: '',
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
  // oxlint-disable-next-line solid/reactivity -- registers a reader once, for a dismiss.
  props.readValues(() => form.state.values)
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
  const projectId = form.useStore((state) => state.values.projectId)

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
      <div class="grid gap-1.5">
        <h2 id="entry-popover-title" class="leading-none font-medium">
          {TITLES[target.kind]()}
        </h2>
        <p id="entry-popover-description" class="text-muted-foreground text-sm">
          {m.entry_dialog_zone({ zone: props.zone.replaceAll('_', ' ') })}
        </p>
      </div>
      <form.Field name="description">
        {(field) => (
          <DescriptionCombobox
            label={m.entry_description()}
            placeholder={m.entry_description_placeholder()}
            value={field().state.value}
            projectId={projectId()}
            entries={props.entries}
            projects={props.projects}
            onChange={field().handleChange}
            onPick={(picked) => {
              field().handleChange(picked.description)
              form.setFieldValue('projectId', picked.projectId ?? '')
            }}
          />
        )}
      </form.Field>
      <form.Field name="projectId">
        {(field) => (
          <ProjectSelect
            id="entry-project"
            class="grid gap-1.5"
            label={m.timer_project()}
            projects={props.projects}
            value={field().state.value}
            onChange={field().handleChange}
          />
        )}
      </form.Field>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <form.Field name="date">
          {(field) => (
            <div class="col-span-2 grid gap-1.5 sm:col-span-1">
              <Label for="entry-date">{m.entry_date()}</Label>
              <DatePicker
                id="entry-date"
                value={field().state.value}
                onChange={(value) => field().handleChange(value)}
                weekStart={props.weekStart}
                today={today}
                max={today}
                invalid={!!error()}
                live
                required
              />
            </div>
          )}
        </form.Field>
        <form.Field name="start">
          {(field) => (
            <div class="grid gap-1.5">
              <Label for="entry-start">{m.entry_start()}</Label>
              <TimeInput
                id="entry-start"
                value={field().state.value}
                onChange={(value) => field().handleChange(value)}
                invalid={!!error()}
                required
              />
            </div>
          )}
        </form.Field>
        <Show when={!running}>
          <form.Field name="end">
            {(field) => (
              <div class="grid gap-1.5">
                <Label for="entry-end">{m.entry_end()}</Label>
                <TimeInput
                  id="entry-end"
                  value={field().state.value}
                  onChange={(value) => field().handleChange(value)}
                  invalid={!!error()}
                  required
                />
              </div>
            )}
          </form.Field>
        </Show>
      </div>
      <p class="text-muted-foreground -mt-1 text-sm" aria-live="polite">
        {summary()}
      </p>
      <Show when={error()}>
        <p role="alert" class="text-destructive -mt-3 text-xs font-medium">
          {error()}
        </p>
      </Show>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => props.onCancel()}>
          {m.entry_cancel()}
        </Button>
        <Button type="submit" size="sm">
          {m.entry_save()}
        </Button>
      </div>
    </form>
  )
}
