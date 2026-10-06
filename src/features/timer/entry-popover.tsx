// The entry popover (prototypes/timer.html): logs a past entry by hand under Add entry, or
// edits the running entry's start under the timer's clock. The list edits stopped entries in
// their rows (entry-fields.tsx); the calendar opens this popover beside a new slot or an entry,
// with Delete (prototypes/calendar.html). Times are read in the user's zone; an end at or
// before the start means the next day, and a live line shows the resulting duration. The
// ticket is found in the description on blur and Save, and its chip sits at the end of the
// field. Escape and a click outside keep what was typed into a new entry for the next Add
// entry; Cancel and Save clear it. A calendar slot keeps nothing: its times come from the grid.
import { createForm } from '@tanstack/solid-form'
import TrashIcon from 'lucide-solid/icons/trash'
import { Show, createMemo, createSignal } from 'solid-js'
import { DatePicker } from '~/components/date-time/date-picker'
import { TimeInput } from '~/components/date-time/time-input'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { Popover, PopoverContent } from '~/components/ui/popover'
import { type IsoDate, type WeekStart, localDate, localTime, runningMs } from '~/lib/calendar'
import { useFormatHours } from '~/lib/display-format'
import type { Project } from '~/lib/queries/projects'
import { m } from '~/paraglide/messages.js'
import { DescriptionCombobox } from './description-combobox'
import { type EntryFormError, lastEndToday, readEntryTimes } from './entries'
import { ProjectSelect } from './project-select'
import type { Entry, StoppedEntry } from './queries'
import { TicketChip } from './ticket-chip'
import { caretAfterKey, createTicketDraft } from './ticket-draft'

// A calendar slot's times, and the project of the entry before it.
interface EntrySlot {
  startedAt: Date
  stoppedAt: Date
  projectId: string | null
}

export type EntryPopoverTarget =
  | { kind: 'new'; slot?: EntrySlot }
  | { kind: 'running'; entry: Entry }
  | { kind: 'edit'; entry: StoppedEntry }

export interface EntryPopoverValues {
  description: string
  ticket: string | null
  projectId: string | null
  startedAt: Date
  // Null for the running entry.
  stoppedAt: Date | null
}

interface FormValues {
  description: string
  ticket: string | null
  projectId: string
  date: IsoDate
  start: string
  end: string
}

const ERRORS: Record<EntryFormError, () => string> = {
  missing: m.entry_error_missing,
  missing_running: m.entry_error_missing_running,
  running_future: m.entry_error_running_future,
}

const TITLES = {
  new: m.entry_dialog_new,
  running: m.entry_dialog_edit_running,
  edit: m.entry_dialog_edit,
} as const

// Where the popover opens: under the button, or beside a calendar slot or entry where there's
// room, else under or over it.
const PLACEMENTS = {
  under: { placement: 'bottom-end', flip: true },
  beside: { placement: 'right-start', flip: 'left-start bottom-start top-start' },
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
  // The organization's Issue links setting, for the chip.
  issueLinks: string | null
  position?: keyof typeof PLACEMENTS
  // Where focus goes on close, instead of the anchor, which the calendar may have redrawn.
  returnFocus?: () => HTMLElement | null | undefined
  onSave: (values: EntryPopoverValues) => void
  onDelete?: (entry: StoppedEntry) => void
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
    const target = shown()
    if (target?.kind === 'new' && !target.slot && readValues) setDraft(readValues())
    props.onClose()
  }

  function placement() {
    if (props.position) return PLACEMENTS[props.position]
    const placement = shown()?.kind === 'running' ? 'bottom-start' : 'bottom-end'
    return { placement, flip: true } as const
  }

  return (
    <Popover
      open={props.target !== null}
      onOpenChange={(open) => !open && dismiss()}
      anchorRef={anchor}
      placement={placement().placement}
      flip={placement().flip}
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
          if (!interactedOutside) (props.returnFocus?.() ?? anchor())?.focus()
          interactedOutside = false
        }}
      >
        <Show when={shown()} keyed>
          {(target) => (
            <EntryForm
              target={target}
              draft={target.kind === 'new' && !target.slot ? draft() : null}
              zone={props.zone}
              weekStart={props.weekStart}
              projects={props.projects}
              entries={props.entries}
              issueLinks={props.issueLinks}
              readValues={(read) => (readValues = read)}
              onSave={(values) => {
                setDraft(null)
                props.onSave(values)
              }}
              onCancel={() => {
                setDraft(null)
                props.onClose()
              }}
              onDelete={props.onDelete}
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
  issueLinks: string | null
  readValues: (read: () => FormValues) => void
  onSave: (values: EntryPopoverValues) => void
  onCancel: () => void
  onDelete?: (entry: StoppedEntry) => void
}) {
  const formatHours = useFormatHours()
  // oxlint-disable-next-line solid/reactivity -- the form starts from the target it opened with.
  const target = props.target
  const entry = target.kind === 'new' ? null : target.entry
  // The times and project the form opens with.
  const opened = entry ?? (target.kind === 'new' ? target.slot : undefined)
  const running = target.kind === 'running'
  // oxlint-disable-next-line solid/reactivity -- the latest day to pick, as of opening.
  const today = localDate(Date.now(), props.zone)

  const form = createForm(() => ({
    defaultValues: props.draft ?? {
      description: entry?.description ?? '',
      ticket: entry?.ticket ?? null,
      projectId: opened?.projectId ?? '',
      date: localDate(opened?.startedAt.getTime() ?? Date.now(), props.zone),
      start: opened
        ? localTime(opened.startedAt.getTime(), props.zone)
        : lastEndToday(props.entries, props.zone),
      end: opened?.stoppedAt ? localTime(opened.stoppedAt.getTime(), props.zone) : '',
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
        ticket: value.ticket,
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
  // The error shows once saving was tried, then follows the input.
  const error = form.useStore((state) => {
    const result = readEntryTimes(state.values, {
      running,
      zone: props.zone,
      original: entry ?? undefined,
    })
    return state.submissionAttempts > 0 && result.error ? ERRORS[result.error]() : null
  })
  const projectId = form.useStore((state) => state.values.projectId)
  const ticket = form.useStore((state) => state.values.ticket)

  const ticketDraft = createTicketDraft({
    description: () => form.state.values.description,
    setDescription: (description) => form.setFieldValue('description', description),
    ticket: () => form.state.values.ticket,
    setTicket: (ticket) => form.setFieldValue('ticket', ticket),
  })
  let descriptionInput: HTMLInputElement | undefined

  function untickTicket() {
    const turned = ticketDraft.untick()
    if (turned) caretAfterKey(descriptionInput, turned)
  }

  function summary() {
    const result = times()
    if (result.error) return ''
    if (!result.stoppedAt) {
      return m.entry_running_for({ duration: formatHours(runningMs(result.startedAt, Date.now())) })
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
        ticketDraft.commit()
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
            ticket={ticket()}
            chip={
              <Show when={ticket()}>
                {(key) => (
                  <TicketChip
                    ticket={key()}
                    issueLinks={props.issueLinks}
                    onRemove={untickTicket}
                  />
                )}
              </Show>
            }
            entries={props.entries}
            projects={props.projects}
            ref={(el) => (descriptionInput = el)}
            onChange={field().handleChange}
            onBlur={ticketDraft.commit}
            onPick={(picked) => {
              ticketDraft.reset(picked.description, picked.ticket)
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
      <div class="flex items-center gap-2">
        <Show when={target.kind === 'edit' && props.onDelete && target.entry}>
          {(stopped) => (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="text-destructive hover:text-destructive"
              onClick={() => props.onDelete?.(stopped())}
            >
              <TrashIcon aria-hidden="true" />
              {m.timer_delete()}
            </Button>
          )}
        </Show>
        <div class="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => props.onCancel()}>
            {m.entry_cancel()}
          </Button>
          <Button type="submit" size="sm">
            {m.entry_save()}
          </Button>
        </div>
      </div>
    </form>
  )
}
