// Copy to more days in the entry popover (prototypes/copy-entries.html): a month of days to
// pick, and Repeat with Until to fill the days that match a pattern after the entry's,
// adding to those picked. A click picks or unpicks a day, Shift-click picks the workdays in a
// range, arrow keys move across months, and Space picks. A day that already has the entry,
// at its time with its description and project, shows a dot, and Repeat leaves it out. The
// popover owns the picked days and saves a copy on each.
import { useQueryClient } from '@tanstack/solid-query'
import ChevronDownIcon from 'lucide-solid/icons/chevron-down'
import ChevronLeftIcon from 'lucide-solid/icons/chevron-left'
import ChevronRightIcon from 'lucide-solid/icons/chevron-right'
import CopyIcon from 'lucide-solid/icons/copy'
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onMount,
} from 'solid-js'
import { DatePicker } from '~/components/date-time/date-picker'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { NativeSelect } from '~/components/ui/native-select'
import {
  type IsoDate,
  type WeekStart,
  addDays,
  daysBetween,
  localDate,
  startOfDay,
  startOfWeek,
} from '~/lib/calendar'
import { useHourCycle } from '~/lib/display-format'
import { errorMessage } from '~/lib/errors'
import { formatDateTime, formatIsoDate, formatIsoDateRange } from '~/lib/format'
import type { Region } from '~/lib/holidays/holidays'
import { useQuery } from '~/lib/queries/use-query'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { MAX_BATCH_ENTRIES } from '~/server/entries/entries.schemas'
import { type Entry, entriesQuery } from '../queries'
import {
  type CopyBase,
  PATTERNS,
  type Pattern,
  addMonths,
  copyTimes,
  defaultUntil,
  fillDays,
  isHoliday,
  isWeekendDay,
  monthCells,
  patternLabel,
  rangeDays,
} from './copy-days'

const MINUTE = 60_000
// listEntries reads at most 93 days at a time.
const READ_DAYS = 90
// How far Until reaches, which bounds the reads a Fill makes.
const UNTIL_DAYS = 366

export interface CopyWork {
  description: string
  projectId: string | null
}

const KEYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

export function CopyPanel(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The form's entry; null while its date and times don't read.
  base: CopyBase | null
  work: CopyWork
  // The entry being edited, which doesn't count as a day having it.
  editingId?: string
  owner: { organizationId: string; userId: string }
  zone: string
  weekStart: WeekStart
  region: Region
  picked: readonly IsoDate[]
  onPick: (days: IsoDate[]) => void
  // The most copies one save takes: MAX_BATCH_ENTRIES, less the entry itself when it's new.
  limit: number
  // Filled once on opening, for a paste that repeats.
  pattern?: Pattern
}) {
  const queryClient = useQueryClient()
  const hourCycle = useHourCycle()
  const panelId = createUniqueId()
  const patternId = createUniqueId()
  const untilId = createUniqueId()
  // oxlint-disable-next-line solid/reactivity -- the month and pattern start from the opening entry.
  const opening = props.base?.date ?? localDate(Date.now(), props.zone)
  const [month, setMonth] = createSignal(addMonths(opening, 0))
  // oxlint-disable-next-line solid/reactivity -- see above.
  const [pattern, setPattern] = createSignal<Pattern>(props.pattern ?? 'workday')
  // Until as typed; until then it follows the pattern and the entry's day.
  const [typedUntil, setTypedUntil] = createSignal<IsoDate | null>(null)
  const [note, setNote] = createSignal('')
  const [filling, setFilling] = createSignal(false)
  const [focusDay, setFocusDay] = createSignal<IsoDate | null>(null)
  // The last day clicked, where a Shift-click's range starts.
  let anchor: IsoDate | null = null
  let grid: HTMLDivElement | undefined

  function today() {
    return localDate(Date.now(), props.zone)
  }
  function until() {
    const base = props.base
    return typedUntil() ?? (base ? defaultUntil(pattern(), base.date) : today())
  }

  // The entry's own day can't take a copy, also once its date changes.
  createEffect(
    on(
      () => props.base?.date,
      (date) => {
        if (date && props.picked.includes(date))
          props.onPick(props.picked.filter((d) => d !== date))
      },
    ),
  )

  function rangeOf(from: IsoDate, to: IsoDate) {
    return { from: startOfDay(from, props.zone), to: startOfDay(to, props.zone) }
  }
  const shown = useQuery(() =>
    entriesQuery(
      props.owner.organizationId,
      props.owner.userId,
      rangeOf(month(), addMonths(month(), 1)),
    ),
  )

  // Whether the day has an entry of this work at the copy's minute.
  function has(date: IsoDate, entries: readonly Entry[]) {
    const base = props.base
    if (!base) return false
    const start = Math.floor(copyTimes(base, date, props.zone).startedAt / MINUTE)
    const description = props.work.description.trim()
    return entries.some(
      (e) =>
        e.id !== props.editingId &&
        e.stoppedAt !== null &&
        Math.floor(e.startedAt.getTime() / MINUTE) === start &&
        e.description === description &&
        e.projectId === props.work.projectId,
    )
  }

  // The user's entries on the days after the entry's up to Until, read in chunks the list
  // call takes.
  async function entriesThrough(last: IsoDate) {
    const first = addDays(props.base!.date, 1)
    const reads = []
    for (let from = first; from <= last; from = addDays(from, READ_DAYS)) {
      const to = addDays(from, Math.min(READ_DAYS, daysBetween(from, last) + 1))
      reads.push(
        queryClient.fetchQuery(
          entriesQuery(props.owner.organizationId, props.owner.userId, rangeOf(from, to)),
        ),
      )
    }
    return (await Promise.all(reads)).flat()
  }

  async function fill() {
    const base = props.base
    if (!base || filling()) return
    setNote('')
    setFilling(true)
    const last = until()
    let entries: Entry[]
    try {
      entries = await entriesThrough(last)
    } catch (error) {
      setNote(errorMessage(error))
      return
    } finally {
      setFilling(false)
    }
    const { added, had } = fillDays({
      pattern: pattern(),
      base,
      until: last,
      region: props.region,
      has: (date) => has(date, entries),
    })
    const fresh = added.filter((d) => !props.picked.includes(d))
    props.onPick([...props.picked, ...fresh].sort())
    setMonth(addMonths(base.date, 0))
    if (had) setNote(m.copy_left_out({ count: had }))
    else if (!fresh.length) {
      setNote(m.copy_none_match({ date: formatIsoDate(last, { day: 'numeric', month: 'short' }) }))
    }
  }

  onMount(() => {
    if (props.open && props.pattern) void fill()
  })

  function pick(date: IsoDate, range: boolean) {
    const base = props.base
    if (!base || date === base.date) return
    const picked = new Set(props.picked)
    if (range && anchor) for (const d of rangeDays(anchor, date, base, props.region)) picked.add(d)
    else if (picked.has(date)) picked.delete(date)
    else picked.add(date)
    props.onPick([...picked].sort())
    anchor = date
    setFocusDay(date)
    setNote('')
  }

  function onGridKey(event: KeyboardEvent) {
    const date = (event.target as HTMLElement).closest<HTMLElement>('[data-copy-day]')?.dataset
      .copyDay
    const step = KEYS[event.key]
    if (!date || step === undefined) return
    event.preventDefault()
    const next = addDays(date, step)
    setFocusDay(next)
    setMonth(addMonths(next, 0))
    grid?.querySelector<HTMLElement>(`[data-copy-day="${next}"]`)?.focus()
  }

  const cells = createMemo(() => monthCells(month(), props.weekStart))
  const heads = createMemo(() => {
    const first = startOfWeek(month(), props.weekStart)
    return Array.from({ length: 7 }, (_, i) =>
      formatIsoDate(addDays(first, i), { weekday: 'narrow' }),
    )
  })
  const hasDays = createMemo(() => {
    const entries = shown.data ?? []
    return new Set(cells().filter((d): d is IsoDate => !!d && has(d, entries)))
  })
  // The day that takes Tab in the grid: the focused one, a picked one, the entry's, or the 1st.
  function tabDay() {
    function inMonth(d: IsoDate | null | undefined): d is IsoDate {
      return !!d && addMonths(d, 0) === month()
    }
    return [focusDay(), props.picked.find(inMonth), props.base?.date].find(inMonth) ?? month()
  }

  function dayLabel(date: IsoDate) {
    const notes: string[] = []
    if (date === props.base?.date) notes.push(m.copy_day_self())
    if (hasDays().has(date)) notes.push(m.copy_day_has())
    if (isHoliday(date, props.region)) notes.push(m.copy_day_holiday())
    const name = formatIsoDate(date, { weekday: 'long', day: 'numeric', month: 'long' })
    return { label: notes.length ? `${name}, ${notes.join(', ')}` : name, title: notes.join(', ') }
  }

  function formatTime(ms: number) {
    const cycle = hourCycle()
    return formatDateTime(ms, props.zone, {
      hour: cycle === 'h23' ? '2-digit' : 'numeric',
      minute: '2-digit',
      hourCycle: cycle,
    })
  }

  function summary() {
    const picked = props.picked
    const base = props.base
    if (!picked.length || !base) return m.copy_pick_hint()
    const days =
      picked.length <= 4
        ? new Intl.ListFormat(getLocale()).format(
            picked.map((d) =>
              formatIsoDate(d, { weekday: 'short', day: 'numeric', month: 'short' }),
            ),
          )
        : formatIsoDateRange(picked[0], picked.at(-1)!, { day: 'numeric', month: 'short' })
    const times = copyTimes(base, picked[0], props.zone)
    return m.copy_summary({
      count: picked.length,
      days,
      times: `${formatTime(times.startedAt)}–${formatTime(times.stoppedAt)}`,
    })
  }

  return (
    <div class="-mt-2 grid gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="-ml-2 justify-self-start"
        aria-expanded={props.open}
        aria-controls={panelId}
        onClick={() => {
          if (props.open) props.onPick([])
          props.onOpenChange(!props.open)
        }}
      >
        <CopyIcon aria-hidden="true" />
        {m.copy_toggle()}
        <ChevronDownIcon
          aria-hidden="true"
          class={cn('transition-transform', props.open && 'rotate-180')}
        />
      </Button>
      <Show when={props.open}>
        <div id={panelId} class="grid gap-3 rounded-lg border p-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium" aria-live="polite">
              {formatIsoDate(month(), { month: 'long', year: 'numeric' })}
            </span>
            <div class="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="size-7"
                aria-label={m.picker_previous_month()}
                onClick={() => setMonth(addMonths(month(), -1))}
              >
                <ChevronLeftIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="size-7"
                aria-label={m.picker_next_month()}
                onClick={() => setMonth(addMonths(month(), 1))}
              >
                <ChevronRightIcon aria-hidden="true" />
              </Button>
            </div>
          </div>
          <Show
            when={props.base}
            fallback={<p class="text-muted-foreground text-sm">{m.copy_fix_times()}</p>}
          >
            {(base) => (
              <>
                <div
                  ref={grid}
                  role="group"
                  aria-label={m.copy_days()}
                  class="grid grid-cols-7 gap-1"
                  onKeyDown={onGridKey}
                >
                  <For each={heads()}>
                    {(head) => (
                      <span
                        class="text-muted-foreground pb-1 text-center text-xs"
                        aria-hidden="true"
                      >
                        {head}
                      </span>
                    )}
                  </For>
                  <For each={cells()}>
                    {(date) => (
                      <Show when={date} fallback={<span aria-hidden="true" />}>
                        {(day) => (
                          <button
                            type="button"
                            class="copy-day"
                            data-copy-day={day()}
                            aria-pressed={props.picked.includes(day())}
                            tabIndex={day() === tabDay() ? 0 : -1}
                            aria-label={dayLabel(day()).label}
                            title={dayLabel(day()).title || undefined}
                            data-self={day() === base().date ? '' : undefined}
                            data-has={hasDays().has(day()) ? '' : undefined}
                            data-off={
                              isWeekendDay(day()) || isHoliday(day(), props.region) ? '' : undefined
                            }
                            data-today={day() === today() ? '' : undefined}
                            aria-disabled={day() === base().date || undefined}
                            onClick={(event) => pick(day(), event.shiftKey)}
                          >
                            {formatIsoDate(day(), { day: 'numeric' })}
                          </button>
                        )}
                      </Show>
                    )}
                  </For>
                </div>
                <div class="flex flex-wrap items-end gap-2">
                  <div class="grid min-w-0 flex-1 basis-40 gap-1.5">
                    <Label for={patternId} class="text-xs">
                      {m.copy_repeat()}
                    </Label>
                    <NativeSelect
                      id={patternId}
                      value={pattern()}
                      onChange={(event) => {
                        setPattern(event.currentTarget.value as Pattern)
                        setTypedUntil(null)
                      }}
                    >
                      <For each={PATTERNS}>
                        {(kind) => <option value={kind}>{patternLabel(kind, base().date)}</option>}
                      </For>
                    </NativeSelect>
                  </div>
                  <div class="grid gap-1.5">
                    <Label for={untilId} class="text-xs">
                      {m.copy_until()}
                    </Label>
                    <DatePicker
                      id={untilId}
                      class="w-40"
                      value={until()}
                      onChange={(value) => value && setTypedUntil(value)}
                      weekStart={props.weekStart}
                      today={today()}
                      min={addDays(base().date, 1)}
                      max={addDays(base().date, UNTIL_DAYS)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    class="h-10"
                    disabled={filling()}
                    onClick={() => void fill()}
                  >
                    {m.copy_fill()}
                  </Button>
                </div>
                <div class="flex items-start justify-between gap-2">
                  <div class="grid gap-1 text-sm">
                    <p class="text-muted-foreground" aria-live="polite">
                      {summary()}
                      <Show when={note()}>
                        <br />
                        {note()}
                      </Show>
                    </p>
                    <Show when={props.picked.length > props.limit}>
                      <p role="alert" class="text-destructive text-xs font-medium">
                        {m.validation_too_many_entries({ max: MAX_BATCH_ENTRIES })}
                      </p>
                    </Show>
                    <p class="text-muted-foreground text-xs">{m.copy_legend()}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="-mt-1 -mr-1"
                    onClick={() => {
                      setNote('')
                      props.onPick([])
                    }}
                  >
                    {m.copy_clear()}
                  </Button>
                </div>
              </>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}
