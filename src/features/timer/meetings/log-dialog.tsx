// Log meetings (prototypes/calendar-events.html): a range's meetings, the calendar's week by
// default, each with a checkbox and the project it logs to. A meeting starts checked once it has
// started and auto-track would log it; an all-day event is listed per day, unchecked, to log as a
// day. A day's heading checks or unchecks all its meetings not yet logged. One save is one
// createEntries, at most MAX_BATCH_ENTRIES, with one Undo.
import CheckIcon from 'lucide-solid/icons/check'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { DatePicker } from '~/components/date-time/date-picker'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
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
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import {
  type IsoDate,
  type WeekStart,
  addDays,
  daysBetween,
  localDate,
  startOfDay,
  startOfWeek,
} from '~/lib/calendar'
import { useFormatHours } from '~/lib/display-format'
import { errorMessage } from '~/lib/errors'
import { formatIsoDate } from '~/lib/format'
import type { Region } from '~/lib/holidays/holidays'
import type { Project } from '~/lib/queries/projects'
import { useQuery } from '~/lib/queries/use-query'
import { m } from '~/paraglide/messages.js'
import { type CalendarEvent, MAX_EVENT_DAYS } from '~/server/calendar/calendar.schemas'
import { MAX_BATCH_ENTRIES } from '~/server/entries/entries.schemas'
import { formatRange } from '../calendar/calendar-block'
import { projectChoices } from '../project-select'
import { meetingTitle } from './event-block'
import {
  DAY_HOURS,
  DAY_START,
  type Loggable,
  type LogState,
  type SkipReason,
  loggablesIn,
  logState,
  skipReason,
  startsChecked,
} from './meetings'
import { calendarEventsQuery } from './queries'

const PRESETS = ['today', 'yesterday', 'week', 'last-week'] as const
type Preset = (typeof PRESETS)[number]

const PRESET_LABELS = {
  today: m.timer_today,
  yesterday: m.log_yesterday,
  week: m.log_this_week,
  'last-week': m.log_last_week,
}

const SKIPS: Record<SkipReason, () => string> = {
  all_day: m.meeting_all_day,
  working_location: m.meeting_working_location,
  out_of_office: m.meeting_out_of_office,
  focus_time: m.log_skip_focus_time,
  declined: m.log_skip_declined,
  free: m.meeting_shown_free,
}

function presetRange(preset: Preset, today: IsoDate, weekStart: WeekStart) {
  const week = startOfWeek(today, weekStart)
  if (preset === 'yesterday') return { from: addDays(today, -1), to: addDays(today, -1) }
  if (preset === 'week') return { from: week, to: addDays(week, 6) }
  if (preset === 'last-week') return { from: addDays(week, -7), to: addDays(week, -1) }
  return { from: today, to: today }
}

export interface LogChoice {
  item: Loggable
  projectId: string | null
}

export function LogDialog(props: {
  open: boolean
  // The range it opens on: the week the calendar shows.
  initial: { from: IsoDate; to: IsoDate }
  organizationId: string
  zone: string
  region: Region
  weekStart: WeekStart
  today: IsoDate
  now: number
  projects: readonly Project[]
  // The project a meeting starts with, which the user can change.
  suggest: (event: CalendarEvent) => string | null
  entryKeys: ReadonlySet<string>
  formatTime: (ms: number) => string
  onLog: (choices: LogChoice[]) => void
  onClose: () => void
}) {
  const formatHours = useFormatHours()
  const [from, setFrom] = createSignal(props.initial.from)
  const [to, setTo] = createSignal(props.initial.to)
  // Each item's choice by key, kept while the dialog is open.
  const [picks, setPicks] = createStore<Record<string, { checked: boolean; projectId: string }>>({})

  function days() {
    return daysBetween(from(), to()) + 1
  }
  function valid() {
    return to() >= from() && days() <= MAX_EVENT_DAYS
  }
  const range = createMemo(() => ({
    from: startOfDay(from(), props.zone),
    to: startOfDay(addDays(to(), 1), props.zone),
  }))
  const events = useQuery(() => ({
    ...calendarEventsQuery(props.organizationId, range()),
    enabled: props.open && valid(),
  }))

  function stateOf(key: string): LogState {
    return logState(key, props.entryKeys, events.data?.logs ?? [], props.organizationId)
  }
  const items = createMemo(() =>
    valid() ? loggablesIn(events.data?.events ?? [], range(), props.zone, props.region) : [],
  )
  function selectable(item: Loggable) {
    const state = stateOf(item.key)
    return state === null || state === 'deleted'
  }
  function pick(item: Loggable) {
    return (
      picks[item.key] ?? {
        checked: startsChecked(item, stateOf(item.key), props.now),
        projectId: props.suggest(item.event) ?? '',
      }
    )
  }
  function setPick(item: Loggable, patch: Partial<{ checked: boolean; projectId: string }>) {
    setPicks(
      produce((all) => {
        all[item.key] = { ...pick(item), ...patch }
      }),
    )
  }
  const chosen = createMemo(() => items().filter((i) => selectable(i) && pick(i).checked))
  function total() {
    return chosen().reduce((sum, i) => sum + i.stoppedAt - i.startedAt, 0)
  }
  function tooMany() {
    return chosen().length > MAX_BATCH_ENTRIES
  }

  function presetOn(preset: Preset) {
    const r = presetRange(preset, props.today, props.weekStart)
    return r.from === from() && r.to === to()
  }

  function rowNote(item: Loggable) {
    const state = stateOf(item.key)
    if (state === 'here') return m.log_logged()
    if (state === 'elsewhere') return m.meeting_logged_elsewhere()
    if (item.event.allDay) {
      return m.log_logs_day({
        times: formatRange(props.formatTime, item.startedAt, item.stoppedAt),
      })
    }
    if (item.startedAt > props.now) return m.log_not_started()
    if (state === 'deleted') return m.log_entry_deleted()
    const reason = skipReason(item.event)
    return reason ? SKIPS[reason]() : ''
  }

  function save() {
    props.onLog(chosen().map((item) => ({ item, projectId: pick(item).projectId || null })))
  }

  function dayOf(item: Loggable) {
    return localDate(item.startedAt, props.zone)
  }
  // A day's heading above its first row.
  function dayHeading(item: Loggable, index: number) {
    const date = dayOf(item)
    const previous = items()[index - 1]
    if (previous && dayOf(previous) === date) return null
    return { date, label: formatIsoDate(date, { weekday: 'long', day: 'numeric', month: 'long' }) }
  }
  function openOn(date: IsoDate) {
    return items().filter((i) => dayOf(i) === date && selectable(i))
  }
  function checkedOn(date: IsoDate) {
    return openOn(date).filter((i) => pick(i).checked).length
  }
  function setDay(date: IsoDate, checked: boolean) {
    for (const item of openOn(date)) setPick(item, { checked })
  }

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent class="grid max-w-2xl grid-cols-[minmax(0,1fr)] gap-4">
        <DialogHeader>
          <DialogTitle>{m.log_meetings()}</DialogTitle>
          <DialogDescription>
            {m.log_meetings_description({ hours: DAY_HOURS, time: DAY_START })}
          </DialogDescription>
        </DialogHeader>
        <div class="flex flex-wrap items-end gap-3">
          <ToggleGroup
            variant="outline"
            size="sm"
            class="flex-wrap justify-start"
            aria-label={m.log_range()}
            value={PRESETS.find(presetOn) ?? null}
            onChange={(value) => {
              if (!value) return
              const r = presetRange(value as Preset, props.today, props.weekStart)
              setFrom(r.from)
              setTo(r.to)
            }}
          >
            <For each={PRESETS}>
              {(preset) => (
                <ToggleGroupItem value={preset}>{PRESET_LABELS[preset]()}</ToggleGroupItem>
              )}
            </For>
          </ToggleGroup>
          <div class="flex flex-wrap items-end gap-3">
            <div class="grid gap-1.5">
              <Label for="log-from">{m.log_from()}</Label>
              <DatePicker
                id="log-from"
                value={from()}
                onChange={setFrom}
                weekStart={props.weekStart}
                today={props.today}
                class="w-40"
              />
            </div>
            <div class="grid gap-1.5">
              <Label for="log-to">{m.log_to()}</Label>
              <DatePicker
                id="log-to"
                value={to()}
                onChange={setTo}
                weekStart={props.weekStart}
                today={props.today}
                class="w-40"
              />
            </div>
          </div>
        </div>
        <div class="max-h-[min(24rem,50dvh)] overflow-y-auto rounded-md border">
          <Show
            when={valid() && !events.isPending && items().length > 0}
            fallback={
              <p class="text-muted-foreground flex items-center justify-center gap-2 px-4 py-8 text-center text-sm">
                <Show when={valid() && events.isPending}>
                  <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
                </Show>
                {!valid()
                  ? to() < from()
                    ? m.log_pick_range()
                    : m.log_range_too_long({ days: MAX_EVENT_DAYS })
                  : events.isError
                    ? errorMessage(events.error)
                    : events.isPending
                      ? m.log_loading()
                      : m.log_empty()}
              </p>
            }
          >
            <For each={items()}>
              {(item, index) => {
                const id = `log-${item.key}`
                return (
                  <>
                    <Show when={dayHeading(item, index())}>
                      {(heading) => {
                        const dayId = `log-day-${heading().date}`
                        function open() {
                          return openOn(heading().date).length
                        }
                        function checked() {
                          return checkedOn(heading().date)
                        }
                        return (
                          <div class="bg-muted sticky top-0 z-[1] flex items-center gap-3 border-y px-3 py-1.5 text-xs font-medium first:border-t-0">
                            <Checkbox
                              id={dayId}
                              checked={open() > 0 && checked() === open()}
                              indeterminate={checked() > 0 && checked() < open()}
                              disabled={!open()}
                              onChange={(on: boolean) => setDay(heading().date, on)}
                            />
                            <Label for={`${dayId}-input`} class="min-w-0 flex-1 text-xs">
                              {heading().label}
                            </Label>
                          </div>
                        )
                      }}
                    </Show>
                    <div
                      class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 [&+&]:border-t"
                      classList={{ 'text-muted-foreground': !selectable(item) }}
                    >
                      {/* A logged meeting shows a check, at the checkbox's size, in its place. */}
                      <Show
                        when={selectable(item)}
                        fallback={<CheckIcon class="size-4 shrink-0" aria-hidden="true" />}
                      >
                        <Checkbox
                          id={id}
                          checked={pick(item).checked}
                          onChange={(checked: boolean) => setPick(item, { checked })}
                        />
                      </Show>
                      <Label
                        for={`${id}-input`}
                        class="flex min-w-0 flex-1 basis-56 items-center gap-3 font-normal"
                      >
                        <span class="text-muted-foreground w-[5.75rem] shrink-0 tabular-nums">
                          {item.event.allDay
                            ? m.meeting_all_day()
                            : formatRange(props.formatTime, item.startedAt, item.stoppedAt)}
                        </span>
                        <span class="grid min-w-0 gap-0.5">
                          <span
                            class="min-w-0 truncate font-medium"
                            classList={{ 'line-through': item.event.response === 'declined' }}
                          >
                            {meetingTitle(item.event)}
                          </span>
                          <Show when={rowNote(item)}>
                            <span class="text-muted-foreground text-xs">{rowNote(item)}</span>
                          </Show>
                        </span>
                      </Label>
                      <Show when={selectable(item)}>
                        <NativeSelect
                          class="w-full sm:w-48"
                          aria-label={m.log_project_for({ title: meetingTitle(item.event) })}
                          value={pick(item).projectId}
                          onChange={(event) =>
                            setPick(item, { projectId: event.currentTarget.value })
                          }
                        >
                          <For each={projectChoices(props.projects, pick(item).projectId)}>
                            {(choice) => <option value={choice.value}>{choice.label}</option>}
                          </For>
                        </NativeSelect>
                      </Show>
                    </div>
                  </>
                )
              }}
            </For>
          </Show>
        </div>
        <p class="text-muted-foreground text-sm" aria-live="polite">
          <Show when={chosen().length} fallback={items().length ? m.log_none_checked() : ''}>
            {m.log_checked({ count: chosen().length, hours: formatHours(total()) })}
            <Show when={tooMany()}>
              {' '}
              <span class="text-destructive">{m.log_too_many({ max: MAX_BATCH_ENTRIES })}</span>
            </Show>
          </Show>
        </p>
        <DialogFooter class="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => props.onClose()}>
            {m.confirm_cancel()}
          </Button>
          <Button disabled={!chosen().length || tooMany()} onClick={save}>
            {chosen().length ? m.log_save({ count: chosen().length }) : m.log_meetings()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
