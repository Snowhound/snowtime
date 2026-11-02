// The entry popover's Repeat (prototypes/copy-entries.html): a pattern fills the days after the
// entry's that match it, up to Until, at once, leaving out the days that already have the
// entry, at its time with its description and project. The month under it previews the copies:
// a click takes a day out or adds one the pattern left out, and arrow keys move across months.
// Those exceptions stay when Until, the pattern, or the entry's times change. The popover saves
// a copy on each day it hands back.
import { useQueryClient } from '@tanstack/solid-query'
import ChevronLeftIcon from 'lucide-solid/icons/chevron-left'
import ChevronRightIcon from 'lucide-solid/icons/chevron-right'
import { For, Show, createEffect, createMemo, createSignal, createUniqueId, on } from 'solid-js'
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
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { MAX_BATCH_ENTRIES } from '~/server/entries/entries.schemas'
import { type Entry, entriesQuery } from '../queries'
import {
  type CopyBase,
  PATTERNS,
  type Repeat,
  addMonths,
  copyTimes,
  defaultUntil,
  isHoliday,
  isWeekendDay,
  monthCells,
  patternDays,
  patternLabel,
} from './repeat-days'

const MINUTE = 60_000
// listEntries reads at most 93 days at a time.
const READ_DAYS = 90
// How far Until reaches, which bounds the reads behind the preview.
const UNTIL_DAYS = 366

export interface RepeatWork {
  description: string
  projectId: string | null
}

const KEYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

export function RepeatField(props: {
  // The form's entry; null while its date and times don't read.
  base: CopyBase | null
  work: RepeatWork
  // The entry being edited, which doesn't count as a day having it.
  editingId?: string
  owner: { organizationId: string; userId: string }
  zone: string
  weekStart: WeekStart
  region: Region
  // The most copies one save takes: MAX_BATCH_ENTRIES, less the entry itself when it's new.
  limit: number
  // The pattern it opens with, for a paste that repeats.
  initial?: Repeat
  // The days to copy to, sorted, and whether the days that have the entry are known yet.
  onDays: (days: IsoDate[], ready: boolean) => void
}) {
  const queryClient = useQueryClient()
  const hourCycle = useHourCycle()
  const repeatId = createUniqueId()
  const untilId = createUniqueId()
  // oxlint-disable-next-line solid/reactivity -- the field starts from the opening entry.
  const opening = props.base?.date ?? localDate(Date.now(), props.zone)
  const [repeat, setRepeat] = createSignal<Repeat>(props.initial ?? 'none')
  const [month, setMonth] = createSignal(addMonths(opening, 0))
  // Until as typed; until then it follows the pattern and the entry's day.
  const [typedUntil, setTypedUntil] = createSignal<IsoDate | null>(null)
  // Days clicked out of the pattern's, and days clicked in.
  const [removed, setRemoved] = createSignal<ReadonlySet<IsoDate>>(new Set())
  const [added, setAdded] = createSignal<ReadonlySet<IsoDate>>(new Set())
  const [focusDay, setFocusDay] = createSignal<IsoDate | null>(null)
  let grid: HTMLDivElement | undefined

  function today() {
    return localDate(Date.now(), props.zone)
  }
  function until(base: CopyBase) {
    const pattern = repeat()
    return typedUntil() ?? defaultUntil(pattern === 'none' ? 'workday' : pattern, base.date)
  }
  function rangeOf(from: IsoDate, to: IsoDate) {
    return { from: startOfDay(from, props.zone), to: startOfDay(to, props.zone) }
  }

  // The user's entries from the day after the entry's to Until, read in chunks the list call
  // takes, for the days that already have it.
  const [known, setKnown] = createSignal<readonly Entry[]>([])
  const [reading, setReading] = createSignal(false)
  const [readError, setReadError] = createSignal<string | null>(null)
  const span = createMemo(() => {
    const base = props.base
    return base && repeat() !== 'none' ? `${addDays(base.date, 1)}|${until(base)}` : null
  })
  let read = 0
  // A read that a later one replaced is dropped.
  async function load(reads: Promise<Entry[]>[]) {
    const mine = ++read
    setReading(true)
    setReadError(null)
    try {
      const lists = await Promise.all(reads)
      if (mine === read) setKnown(lists.flat())
    } catch (error) {
      if (mine === read) setReadError(errorMessage(error))
    } finally {
      if (mine === read) setReading(false)
    }
  }
  createEffect(
    on(span, (current) => {
      if (!current) return
      const [first, last] = current.split('|')
      const reads = []
      for (let from = first; from <= last; from = addDays(from, READ_DAYS)) {
        const to = addDays(from, Math.min(READ_DAYS, daysBetween(from, last) + 1))
        const range = rangeOf(from, to)
        reads.push(
          queryClient.fetchQuery(
            entriesQuery(props.owner.organizationId, props.owner.userId, range),
          ),
        )
      }
      void load(reads)
    }),
  )
  // The shown month, for the dots on days outside the pattern's.
  const shown = useQuery(() => ({
    ...entriesQuery(
      props.owner.organizationId,
      props.owner.userId,
      rangeOf(month(), addMonths(month(), 1)),
    ),
    enabled: repeat() !== 'none',
  }))

  // Whether the day has an entry of this work at the copy's minute.
  function has(date: IsoDate) {
    const base = props.base
    if (!base) return false
    const start = Math.floor(copyTimes(base, date, props.zone).startedAt / MINUTE)
    const description = props.work.description.trim()
    return [...known(), ...(shown.data ?? [])].some(
      (e) =>
        e.id !== props.editingId &&
        e.stoppedAt !== null &&
        Math.floor(e.startedAt.getTime() / MINUTE) === start &&
        e.description === description &&
        e.projectId === props.work.projectId,
    )
  }

  const fromPattern = createMemo(() => {
    const base = props.base
    const pattern = repeat()
    if (!base || pattern === 'none') return { days: new Set<IsoDate>(), had: 0 }
    const { added: days, had } = patternDays({
      pattern,
      base,
      until: until(base),
      region: props.region,
      has,
    })
    return { days: new Set(days), had }
  })
  // The copies: the pattern's days less those clicked out, and the days clicked in.
  const days = createMemo(() => {
    const base = props.base
    if (!base || repeat() === 'none') return []
    const picked = new Set([...fromPattern().days].filter((d) => !removed().has(d)))
    for (const d of added()) if (d !== base.date) picked.add(d)
    return [...picked].sort()
  })
  createEffect(() => props.onDays(days(), repeat() === 'none' || !reading()))

  function choose(value: Repeat) {
    setRepeat(value)
    setTypedUntil(null)
    if (props.base) setMonth(addMonths(props.base.date, 0))
  }

  function toggle(date: IsoDate) {
    const base = props.base
    if (!base || date === base.date) return
    const inPattern = fromPattern().days.has(date)
    function without(set: ReadonlySet<IsoDate>) {
      const next = new Set(set)
      next.delete(date)
      return next
    }
    if (days().includes(date)) {
      setAdded(without)
      if (inPattern) setRemoved((set) => new Set(set).add(date))
    } else {
      setRemoved(without)
      if (!inPattern) setAdded((set) => new Set(set).add(date))
    }
    setFocusDay(date)
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
  const hasDays = createMemo(() => new Set(cells().filter((d): d is IsoDate => !!d && has(d))))
  // The day that takes Tab in the grid: the focused one, a copy, the entry's, or the 1st.
  function tabDay() {
    function inMonth(d: IsoDate | null | undefined): d is IsoDate {
      return !!d && addMonths(d, 0) === month()
    }
    return [focusDay(), days().find(inMonth), props.base?.date].find(inMonth) ?? month()
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

  function summary(base: CopyBase) {
    const picked = days()
    if (!picked.length) {
      const date = formatIsoDate(until(base), { day: 'numeric', month: 'short' })
      return m.copy_none_match({ date })
    }
    const list =
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
      days: list,
      times: `${formatTime(times.startedAt)}–${formatTime(times.stoppedAt)}`,
    })
  }

  return (
    <div class="-mt-1 grid gap-3">
      <div class="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div class="grid min-w-0 flex-1 basis-48 gap-1.5">
          <Label for={repeatId}>{m.copy_repeat()}</Label>
          <NativeSelect
            id={repeatId}
            data-repeat
            value={repeat()}
            onChange={(event) => choose(event.currentTarget.value as Repeat)}
          >
            <option value="none">{m.copy_repeat_none()}</option>
            <For each={PATTERNS}>
              {(kind) => (
                <option value={kind}>{patternLabel(kind, props.base?.date ?? today())}</option>
              )}
            </For>
          </NativeSelect>
        </div>
        <Show when={repeat() !== 'none' && props.base}>
          {(base) => (
            <div class="grid gap-1.5">
              <Label for={untilId}>{m.copy_until()}</Label>
              <DatePicker
                id={untilId}
                class="w-44"
                value={until(base())}
                onChange={(value) => value && setTypedUntil(value)}
                weekStart={props.weekStart}
                today={today()}
                min={addDays(base().date, 1)}
                max={addDays(base().date, UNTIL_DAYS)}
                live
              />
            </div>
          )}
        </Show>
      </div>
      <Show when={repeat() !== 'none'}>
        <div class="grid gap-3 rounded-lg border p-3">
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
                            aria-pressed={days().includes(day())}
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
                            onClick={() => toggle(day())}
                          >
                            {formatIsoDate(day(), { day: 'numeric' })}
                          </button>
                        )}
                      </Show>
                    )}
                  </For>
                </div>
                <div class="grid gap-1 text-sm">
                  <p class="text-muted-foreground" aria-live="polite">
                    {summary(base())}
                    <Show when={fromPattern().had}>
                      {(had) => (
                        <>
                          <br />
                          {m.copy_left_out({ count: had() })}
                        </>
                      )}
                    </Show>
                  </p>
                  <Show when={readError()}>
                    <p role="alert" class="text-destructive text-xs font-medium">
                      {readError()}
                    </p>
                  </Show>
                  <Show when={days().length > props.limit}>
                    <p role="alert" class="text-destructive text-xs font-medium">
                      {m.validation_too_many_entries({ max: MAX_BATCH_ENTRIES })}
                    </p>
                  </Show>
                  <p class="text-muted-foreground text-xs">{m.copy_legend()}</p>
                </div>
              </>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}
