// The entry popover (prototypes/timer.html): logs a past entry by hand under Add entry, or
// edits the running entry's start under the timer's clock. The list edits stopped entries in
// their rows (entry-fields.tsx); the calendar opens this popover beside a new slot or an entry,
// with Delete (prototypes/calendar.html). Times are read in the user's zone; an end at or
// before the start means the next day. Start, end, and duration are one range: a typed
// duration moves the end, or the running entry's start (duration-input.ts). The
// ticket is found in the description on blur and Save, and its chip sits at the end of the
// field. Escape and a click outside keep what was typed into a new entry for the next Add
// entry; Cancel and Save clear it. A calendar slot keeps nothing: its times come from the grid.
// Copy to more days (copy-panel/) picks more days for a stopped or new entry, and Save sends
// the entry with a copy on each of them; a paste opens a slot with the copied work and the
// panel filled by a pattern.
import { createForm } from '@tanstack/solid-form'
import CopyPlusIcon from 'lucide-solid/icons/copy-plus'
import TrashIcon from 'lucide-solid/icons/trash'
import { Show, createMemo, createSignal } from 'solid-js'
import { DatePicker } from '~/components/date-time/date-picker'
import { FIELD_CLASS } from '~/components/date-time/field-class'
import { TimeInput } from '~/components/date-time/time-input'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { Popover, PopoverContent } from '~/components/ui/popover'
import { type IsoDate, type WeekStart, localDate, localTime } from '~/lib/calendar'
import { formatHours } from '~/lib/format'
import type { Region } from '~/lib/holidays/holidays'
import type { Project } from '~/lib/queries/projects'
import { m } from '~/paraglide/messages.js'
import { MAX_BATCH_ENTRIES } from '~/server/entries/entries.schemas'
import { type Pattern, copyTimes } from './copy-panel/copy-days'
import { CopyPanel } from './copy-panel/copy-panel'
import { DescriptionCombobox } from './description-combobox'
import { durationErrorMessage, formatDurationInput, parseDuration } from './duration-input'
import { type EntryFormError, lastEndToday, readEntryTimes, readStart } from './entries'
import { ProjectSelect } from './project-select'
import type { Entry, StoppedEntry } from './queries'
import { TicketChip } from './ticket-chip'
import { caretAfterKey, createTicketDraft } from './ticket-draft'

// A calendar slot's times, and the project of the entry before it; a paste brings the
// copied entry's description and ticket too.
interface EntrySlot {
  startedAt: Date
  stoppedAt: Date
  projectId: string | null
  description?: string
  ticket?: string | null
}

// `copy` opens Copy to more days, filled by the pattern when one is given.
export type EntryPopoverTarget =
  | { kind: 'new'; slot?: EntrySlot; copy?: Pattern }
  | { kind: 'running'; entry: Entry }
  | { kind: 'edit'; entry: StoppedEntry; copy?: true }

interface EntryCopy {
  startedAt: Date
  stoppedAt: Date
}

export interface EntryPopoverValues {
  description: string
  ticket: string | null
  projectId: string | null
  startedAt: Date
  // Null for the running entry.
  stoppedAt: Date | null
  // A copy of the entry on each day picked under Copy to more days.
  copies: EntryCopy[]
}

interface FormValues {
  description: string
  ticket: string | null
  projectId: string
  date: IsoDate
  start: string
  end: string
  // As typed; it follows the times while they're typed, and moves the end when it is.
  duration: string
}

const MINUTE = 60_000

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
  // Whose entries the copy panel checks for days that already have the entry.
  owner: { organizationId: string; userId: string }
  // Where Every workday finds the public holidays.
  region: Region
  position?: keyof typeof PLACEMENTS
  // Where focus goes on close, instead of the anchor, which the calendar may have redrawn.
  returnFocus?: () => HTMLElement | null | undefined
  onSave: (values: EntryPopoverValues) => void
  onDelete?: (entry: StoppedEntry) => void
  onDuplicate?: (entry: StoppedEntry) => void
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
        class="max-h-[calc(100dvh-1rem)] w-[28rem] max-w-[calc(100vw-1rem)] overflow-y-auto"
        aria-labelledby="entry-popover-title"
        aria-describedby="entry-popover-description"
        // The buttons that open the popover carry data-entry-trigger, so a click on one while
        // it is open switches or closes it instead of counting as a click outside.
        onInteractOutside={(event: Event) => {
          if (
            (event.target as Element | null)?.closest('[data-entry-trigger], [data-issue-picker]')
          ) {
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
              owner={props.owner}
              region={props.region}
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
              onDuplicate={props.onDuplicate}
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
  owner: { organizationId: string; userId: string }
  region: Region
  readValues: (read: () => FormValues) => void
  onSave: (values: EntryPopoverValues) => void
  onCancel: () => void
  onDelete?: (entry: StoppedEntry) => void
  onDuplicate?: (entry: StoppedEntry) => void
}) {
  // oxlint-disable-next-line solid/reactivity -- the form starts from the target it opened with.
  const target = props.target
  const entry = target.kind === 'new' ? null : target.entry
  // The times and project the form opens with.
  const opened = entry ?? (target.kind === 'new' ? target.slot : undefined)
  const running = target.kind === 'running'
  const slot = target.kind === 'new' ? target.slot : undefined
  // oxlint-disable-next-line solid/reactivity -- today as of opening.
  const today = localDate(Date.now(), props.zone)
  // Whether the duration was typed after the times: Save then keeps it to the second, and
  // only then does a duration that doesn't read stop it.
  const [durationTyped, setDurationTyped] = createSignal(false)
  const [durationFocused, setDurationFocused] = createSignal(false)
  const [durationLeft, setDurationLeft] = createSignal(false)

  function read(values: FormValues) {
    return readEntryTimes(values, { running, zone: props.zone, original: entry ?? undefined })
  }

  // The times' duration as the field shows it; null while they don't read.
  function durationOf(values: FormValues) {
    const result = read(values)
    if (result.error) return null
    const end = result.stoppedAt?.getTime() ?? Date.now()
    const ms = end - result.startedAt.getTime()
    return ms > 0 ? formatDurationInput(ms) : null
  }

  // The values the form opens with, without a draft.
  function opening(): FormValues {
    const values = {
      description: entry?.description ?? slot?.description ?? '',
      ticket: entry?.ticket ?? slot?.ticket ?? null,
      projectId: opened?.projectId ?? '',
      date: localDate(opened?.startedAt.getTime() ?? Date.now(), props.zone),
      start: opened
        ? localTime(opened.startedAt.getTime(), props.zone)
        : lastEndToday(props.entries, props.zone),
      end: opened?.stoppedAt ? localTime(opened.stoppedAt.getTime(), props.zone) : '',
      duration: '',
    }
    return { ...values, duration: durationOf(values) ?? '' }
  }

  // The times Save sends, null while they don't read. A typed duration counts to the second
  // from the start.
  function saved(values: FormValues) {
    const typed = parseDuration(values.duration)
    if (typed.error && durationTyped()) return null
    const times = read(values)
    if (times.error) return null
    const stoppedAt =
      times.stoppedAt && typed.ms !== undefined && durationTyped()
        ? new Date(times.startedAt.getTime() + typed.ms)
        : times.stoppedAt
    return { startedAt: times.startedAt, stoppedAt }
  }

  // Copy to more days, for a stopped or new entry.
  const [copyOpen, setCopyOpen] = createSignal(!running && !!target.copy)
  const [picked, setPicked] = createSignal<IsoDate[]>([])
  // The entry itself counts toward the batch when it's new.
  const copyLimit = MAX_BATCH_ENTRIES - (target.kind === 'new' ? 1 : 0)

  function copiesOf(times: { startedAt: Date; stoppedAt: Date }): EntryCopy[] {
    if (!copyOpen()) return []
    const date = localDate(times.startedAt.getTime(), props.zone)
    const base = {
      date,
      startedAt: times.startedAt.getTime(),
      length: times.stoppedAt.getTime() - times.startedAt.getTime(),
    }
    return picked()
      .filter((d) => d !== date)
      .map((d) => {
        const copy = copyTimes(base, d, props.zone)
        return { startedAt: new Date(copy.startedAt), stoppedAt: new Date(copy.stoppedAt) }
      })
  }

  const form = createForm(() => ({
    defaultValues: props.draft ?? opening(),
    onSubmit: ({ value }) => {
      const times = saved(value)
      if (!times) return
      const copies = times.stoppedAt ? copiesOf({ ...times, stoppedAt: times.stoppedAt }) : []
      if (copies.length > copyLimit) return
      props.onSave({
        description: value.description.trim(),
        ticket: value.ticket,
        projectId: value.projectId || null,
        ...times,
        copies,
      })
    },
  }))

  // A typed date or time recomputes the duration.
  function setTime(key: 'date' | 'start' | 'end', value: string) {
    form.setFieldValue(key, value)
    setDurationTyped(false)
    const duration = durationOf(form.state.values)
    if (duration !== null) form.setFieldValue('duration', duration)
  }

  // A typed duration keeps the start and moves the end; the running entry's end is now, so
  // its start moves.
  function setDuration(text: string) {
    form.setFieldValue('duration', text)
    setDurationTyped(true)
    const typed = parseDuration(text)
    if (typed.error) return
    if (running) {
      const start = Math.floor((Date.now() - typed.ms) / MINUTE) * MINUTE
      form.setFieldValue('date', localDate(start, props.zone))
      form.setFieldValue('start', localTime(start, props.zone))
      return
    }
    const start = readStart(form.state.values, props.zone, entry ?? undefined)
    if (start !== null) form.setFieldValue('end', localTime(start + typed.ms, props.zone))
  }
  // oxlint-disable-next-line solid/reactivity -- registers a reader once, for a dismiss.
  props.readValues(() => form.state.values)
  const times = form.useStore((state) => read(state.values))
  const typed = form.useStore((state) => parseDuration(state.values.duration))
  const attempted = form.useStore((state) => state.submissionAttempts > 0)
  // A duration that doesn't read shows its error once the field is left; the times' error
  // shows once saving was tried. Both then follow the input.
  function error() {
    const duration = typed()
    if (duration.error && durationTyped() && (durationLeft() || attempted())) {
      return { message: durationErrorMessage(duration), field: 'duration' as const }
    }
    const result = times()
    return attempted() && result.error
      ? { message: ERRORS[result.error](), field: 'times' as const }
      : null
  }
  function timesInvalid() {
    return error()?.field === 'times'
  }
  const projectId = form.useStore((state) => state.values.projectId)
  const description = form.useStore((state) => state.values.description)
  // The entry the copies repeat, while its times read.
  const base = form.useStore((state) => {
    const times = running ? null : saved(state.values)
    if (!times?.stoppedAt) return null
    return {
      date: localDate(times.startedAt.getTime(), props.zone),
      startedAt: times.startedAt.getTime(),
      length: times.stoppedAt.getTime() - times.startedAt.getTime(),
    }
  })

  function saveLabel() {
    const count = copyOpen() ? picked().length : 0
    if (!count) return m.entry_save()
    return target.kind === 'new'
      ? m.entry_save_add({ count: count + 1 })
      : m.entry_save_and_copy({ count })
  }
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

  // Under the times: how the duration being typed reads, and an end on the next day.
  function summary() {
    const parts: string[] = []
    if (durationFocused()) {
      const duration = typed()
      parts.push(duration.error ? m.entry_duration_hint() : formatHours(duration.ms, 'units'))
    }
    const result = times()
    if (!result.error && result.nextDay) parts.push(m.entry_row_next_day())
    return parts.join(' · ')
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
            onAddTicket={(ticket) => ticketDraft.addTicket(ticket)}
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
      <form.Field name="date">
        {(field) => (
          <div class="grid gap-1.5">
            <Label for="entry-date">{m.entry_date()}</Label>
            <DatePicker
              id="entry-date"
              class="sm:w-44"
              value={field().state.value}
              onChange={(value) => setTime('date', value)}
              weekStart={props.weekStart}
              today={today}
              invalid={timesInvalid()}
              live
              required
            />
          </div>
        )}
      </form.Field>
      <div class="-mt-1 grid grid-cols-3 gap-4">
        <form.Field name="start">
          {(field) => (
            <div class="grid gap-1.5">
              <Label for="entry-start">{m.entry_start()}</Label>
              <TimeInput
                id="entry-start"
                value={field().state.value}
                onChange={(value) => setTime('start', value)}
                invalid={timesInvalid()}
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
                  onChange={(value) => setTime('end', value)}
                  invalid={timesInvalid()}
                  required
                />
              </div>
            )}
          </form.Field>
        </Show>
        <form.Field name="duration">
          {(field) => (
            <div class="grid gap-1.5">
              <Label for="entry-duration">{m.timer_duration()}</Label>
              <input
                id="entry-duration"
                type="text"
                autocomplete="off"
                spellcheck={false}
                placeholder="1:30"
                class={FIELD_CLASS}
                value={field().state.value}
                aria-invalid={error()?.field === 'duration' || undefined}
                aria-describedby="entry-summary"
                onInput={(event) => setDuration(event.currentTarget.value)}
                onFocus={() => setDurationFocused(true)}
                // Left, it reads back as 1:30, or says why it doesn't read.
                onBlur={() => {
                  setDurationFocused(false)
                  const duration = parseDuration(field().state.value)
                  if (duration.error) setDurationLeft(true)
                  else form.setFieldValue('duration', formatDurationInput(duration.ms))
                }}
              />
            </div>
          )}
        </form.Field>
      </div>
      <p
        id="entry-summary"
        class="text-muted-foreground -mt-2 text-sm empty:hidden"
        aria-live="polite"
      >
        {summary()}
      </p>
      <Show when={error()}>
        {(shown) => (
          <p role="alert" class="text-destructive -mt-3 text-xs font-medium">
            {shown().message}
          </p>
        )}
      </Show>
      <Show when={!running}>
        <CopyPanel
          open={copyOpen()}
          onOpenChange={setCopyOpen}
          base={base()}
          work={{ description: description(), projectId: projectId() || null }}
          editingId={entry?.id}
          owner={props.owner}
          zone={props.zone}
          weekStart={props.weekStart}
          region={props.region}
          picked={picked()}
          onPick={setPicked}
          limit={copyLimit}
          pattern={target.kind === 'new' ? target.copy : undefined}
        />
      </Show>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={target.kind === 'edit' && target.entry}>
          {(stopped) => (
            <>
              <Show when={props.onDelete}>
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
              </Show>
              <Show when={props.onDuplicate}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => props.onDuplicate?.(stopped())}
                >
                  <CopyPlusIcon aria-hidden="true" />
                  {m.entry_duplicate()}
                </Button>
              </Show>
            </>
          )}
        </Show>
        <div class="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => props.onCancel()}>
            {m.entry_cancel()}
          </Button>
          <Button type="submit" size="sm">
            {saveLabel()}
          </Button>
        </div>
      </div>
    </form>
  )
}
