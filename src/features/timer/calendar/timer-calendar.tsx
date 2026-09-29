// The Timer page's week calendar (prototypes/calendar.html; docs/architecture.md, "Timer
// calendar"): the user's entries of the shown week in their zone. A click or a drag on empty
// time adds an entry in the entry popover; dragging an entry or its edges, or Alt+arrow keys on
// it, move it or change its times; a click or Enter edits it. Each change is one optimistic
// mutation (../queries.ts), and the status line under the grid names it with an Undo.
import { keepPreviousData } from '@tanstack/solid-query'
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import { Card } from '~/components/ui/card'
import {
  type IsoDate,
  addDays,
  localDate,
  startOfDay,
  startOfWeek,
  weekRange,
} from '~/lib/calendar'
import { useFormatHours, useHourCycle } from '~/lib/display-format'
import { errorMessage } from '~/lib/errors'
import { formatDateTime, formatIsoDate } from '~/lib/format'
import type { Project } from '~/lib/queries/projects'
import { newId } from '~/lib/queries/query'
import { type Settings, useUpdateSettings } from '~/lib/queries/settings'
import { useQuery } from '~/lib/queries/use-query'
import { m } from '~/paraglide/messages.js'
import type { UpdateEntryInput } from '~/server/entries/entries.schemas'
import { changedFields, entryLabel, lastEnded } from '../entries'
import { EntryPopover, type EntryPopoverTarget, type EntryPopoverValues } from '../entry-popover'
import {
  type Entry,
  type RunningTimer,
  type StoppedEntry,
  entriesQuery,
  useCreateEntry,
  useDeleteEntry,
  useUpdateEntry,
} from '../queries'
import { CalendarBlock, CalendarGhost, HOUR_PX, blockProject, formatRange } from './calendar-block'
import { CalendarHeader } from './calendar-header'
import { CalendarStatus, type Status } from './calendar-status'
import { DROP_ERRORS, createGridDrag } from './grid-drag'
import { createOpeningScroll } from './opening-scroll'
import {
  type Range,
  SNAP_MINUTES,
  addRange,
  isWeekend,
  openingMinute,
  piecesOn,
  sideBySide,
  weekDates,
} from './week-grid'

const MINUTE = 60_000
// The now line and the hatched future move this often.
const TICK_MS = 30_000
const FLASH_MS = 1400
// How long an entry a key moved waits for its block, on the day it moved to, to take focus.
const KEEP_FOCUS_MS = 1500
const HOURS = Array.from({ length: 23 }, (_, i) => i + 1)

const VERBS = {
  moved: m.calendar_moved,
  changed: m.calendar_changed,
  updated: m.calendar_updated,
}

type Patch = Omit<UpdateEntryInput, 'id'>

// What the page's Add entry button does in Calendar view.
export interface CalendarControls {
  addEntry: (button: HTMLElement) => void
}

export function TimerCalendar(props: {
  organizationId: string
  userId: string
  settings: Settings
  projects: readonly Project[]
  running: RunningTimer | null
  // Recent stopped entries, for the popover's suggestions and a new entry's project.
  recent: readonly StoppedEntry[]
  issueLinks: string | null
  controls: (controls: CalendarControls) => void
}) {
  const formatHours = useFormatHours()
  const hourCycle = useHourCycle()
  function zone() {
    return props.settings.timeZone
  }
  function weekStart() {
    return props.settings.weekStart
  }

  const [now, setNow] = createSignal(Date.now())
  function onVisible() {
    if (document.visibilityState === 'visible') setNow(Date.now())
  }
  onMount(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS)
    document.addEventListener('visibilitychange', onVisible)
    onCleanup(() => {
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
    })
  })
  const today = createMemo(() => localDate(now(), zone()))
  function thisWeek() {
    return startOfWeek(today(), weekStart())
  }

  // The shown week's first day, and below 640 px the day shown.
  const [week, setWeek] = createSignal(thisWeek())
  const [day, setDay] = createSignal(today())
  createEffect(on(weekStart, (start) => setWeek((w) => startOfWeek(w, start)), { defer: true }))
  const [narrow, setNarrow] = createSignal(false)
  onMount(() => {
    const query = matchMedia('(max-width: 639px)')
    setNarrow(query.matches)
    function onChange() {
      setNarrow(query.matches)
    }
    query.addEventListener('change', onChange)
    onCleanup(() => query.removeEventListener('change', onChange))
  })

  const range = createMemo(() => weekRange(week(), zone(), weekStart()))
  const weekEntries = useQuery(() => ({
    ...entriesQuery(props.organizationId, props.userId, range()),
    placeholderData: keepPreviousData,
  }))
  // The running timer's cache is the one the timer bar edits, so its entry comes from there.
  const entries = createMemo<Entry[]>(() => {
    const stopped = (weekEntries.data ?? []).filter((e) => e.stoppedAt !== null)
    const running = props.running
    return running?.organizationId === props.organizationId ? [...stopped, running] : stopped
  })
  function findEntry(id: string | undefined) {
    return entries().find((e) => e.id === id)
  }

  const days = createMemo(() => weekDates(week()))
  const placed = createMemo(
    () =>
      new Map(days().map((date) => [date, sideBySide(piecesOn(entries(), date, zone(), now()))])),
  )
  // The weekend shows when the user turned it on, or when the week has time on it.
  const weekendTime = createMemo(() => days().some((d) => isWeekend(d) && totalFor(d) > 0))
  function weekendShown() {
    return props.settings.calendarWeekend || weekendTime()
  }
  const dates = createMemo(() => days().filter((d) => weekendShown() || !isWeekend(d)))
  function shownDay() {
    return dates().includes(day()) ? day() : dates()[0]
  }
  const columns = createMemo(() => (narrow() ? [shownDay()] : dates()))

  function keysOn(date: IsoDate) {
    return (placed().get(date) ?? []).map((p) => p.key)
  }
  function totalFor(date: IsoDate) {
    return (placed().get(date) ?? []).reduce((sum, p) => sum + p.to - p.from, 0)
  }
  function weekTotal() {
    let total = 0
    for (const date of days()) total += totalFor(date)
    return total
  }

  function clock(): Intl.DateTimeFormatOptions {
    const cycle = hourCycle()
    return { hour: cycle === 'h23' ? '2-digit' : 'numeric', minute: '2-digit', hourCycle: cycle }
  }
  function formatTime(ms: number) {
    return formatDateTime(ms, zone(), clock())
  }
  function hourLabel(hour: number) {
    return formatDateTime(Date.UTC(2000, 0, 1, hour), 'UTC', clock())
  }
  function when(startedAt: number, stoppedAt: number | null) {
    const weekday = formatDateTime(startedAt, zone(), { weekday: 'short' })
    return `${weekday} ${formatRange(formatTime, startedAt, stoppedAt)}`
  }

  // oxlint-disable-next-line solid/reactivity -- the page renders a new view per organization.
  const keys = { organizationId: props.organizationId }
  const updateEntry = useUpdateEntry(keys)
  const createEntry = useCreateEntry(keys)
  const deleteEntry = useDeleteEntry(keys)
  const saveSettings = useUpdateSettings()

  const [status, setStatus] = createSignal<Status | null>(null)
  function failed(error: unknown) {
    setStatus({ text: m.entry_save_failed({ error: errorMessage(error) }), error: true })
  }
  const handlers = { onError: failed }
  createEffect(() => {
    if (weekEntries.isError) setStatus({ text: errorMessage(weekEntries.error), error: true })
  })

  function undo() {
    const run = status()?.undo
    setStatus({ text: m.calendar_undone() })
    run?.()
  }

  // A changed entry flashes.
  const [flashId, setFlashId] = createSignal<string | null>(null)
  const [focusId, setFocusId] = createSignal<string | null>(null)
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(focusTimer))
  // The entry's block takes focus once it shows, on the day a key or Undo moved it to.
  function focusEntry(id: string) {
    setFocusId(id)
    clearTimeout(focusTimer)
    focusTimer = setTimeout(() => setFocusId(null), KEEP_FOCUS_MS)
  }
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(flashTimer))
  function flash(id: string) {
    setFlashId(null)
    clearTimeout(flashTimer)
    requestAnimationFrame(() => setFlashId(id))
    flashTimer = setTimeout(() => setFlashId(null), FLASH_MS)
  }

  function goToWeek(first: IsoDate, shown?: IsoDate) {
    setWeek(first)
    setDay(shown ?? (first === thisWeek() ? today() : first))
    setStatus(null)
  }
  // The view follows an entry to its day and week.
  function follow(ms: number) {
    const date = localDate(ms, zone())
    setWeek(startOfWeek(date, weekStart()))
    setDay(date)
  }

  // One updateEntry, with an Undo that puts back the fields it changed.
  function change(entry: Entry, patch: Patch, verb: keyof typeof VERBS) {
    const before: Patch = Object.fromEntries(
      Object.keys(patch).map((key) => [key, entry[key as keyof Patch]]),
    )
    updateEntry.mutate({ id: entry.id, ...patch }, handlers)
    const startedAt = (patch.startedAt ?? entry.startedAt).getTime()
    const stoppedAt = (patch.stoppedAt ?? entry.stoppedAt)?.getTime() ?? null
    setStatus({
      text: VERBS[verb]({
        description: entryLabel({ ...entry, ...patch }),
        when: when(startedAt, stoppedAt),
      }),
      undo: () => {
        updateEntry.mutate({ id: entry.id, ...before }, handlers)
        follow(entry.startedAt.getTime())
        focusEntry(entry.id)
      },
    })
    flash(entry.id)
  }

  // The entry popover: a new slot, an entry to edit, or the running entry.
  const [editor, setEditor] = createSignal<{
    target: EntryPopoverTarget
    button?: HTMLElement
  } | null>(null)
  const [anchor, setAnchor] = createSignal<HTMLElement>()
  let returnTo: (() => HTMLElement | null | undefined) | undefined

  function editingId() {
    const target = editor()?.target
    return target && target.kind !== 'new' ? target.entry.id : null
  }
  function draft() {
    const target = editor()?.target
    return target?.kind === 'new' ? target.slot : undefined
  }

  // A new slot takes the project of the entry that ended last before it.
  function openSlot(slot: Range, button?: HTMLElement) {
    const before = lastEnded([...props.recent, ...entries()], { before: slot.startedAt })
    returnTo = () => button
    setEditor({
      target: {
        kind: 'new',
        slot: {
          startedAt: new Date(slot.startedAt),
          stoppedAt: new Date(slot.stoppedAt),
          projectId: before?.projectId ?? null,
        },
      },
      button,
    })
  }

  function openEntry(entry: Entry, block: HTMLElement) {
    returnTo = () => body?.querySelector<HTMLElement>(`[data-entry="${entry.id}"]`)
    setAnchor(block)
    setEditor({
      target: entry.stoppedAt
        ? { kind: 'edit', entry: entry as StoppedEntry }
        : { kind: 'running', entry },
    })
  }

  // oxlint-disable-next-line solid/reactivity -- hands the page its Add entry once.
  props.controls({
    addEntry(button) {
      if (editor()?.button === button) {
        setEditor(null)
        return
      }
      const slot = addRange([...props.recent, ...entries()], zone(), Date.now())
      follow(slot.startedAt)
      openSlot(slot, button)
    },
  })

  function save(values: EntryPopoverValues) {
    const target = editor()?.target
    setEditor(null)
    if (!target) return
    follow(values.startedAt.getTime())
    if (target.kind === 'new') {
      const id = newId()
      const stoppedAt = values.stoppedAt!
      createEntry.mutate({ id, ...values, stoppedAt }, handlers)
      setStatus({
        text: m.calendar_added({
          description: entryLabel(values),
          when: when(values.startedAt.getTime(), stoppedAt.getTime()),
        }),
        undo: () => deleteEntry.mutate({ id }, handlers),
      })
      flash(id)
      return
    }
    const entry = target.entry
    const patch = changedFields(entry, { ...values, stoppedAt: values.stoppedAt ?? undefined }, [
      'description',
      'ticket',
      'projectId',
      'startedAt',
      'stoppedAt',
    ])
    if (patch) change(entry, patch, 'updated')
  }

  function remove(entry: StoppedEntry) {
    setEditor(null)
    deleteEntry.mutate({ id: entry.id }, handlers)
    setStatus({
      text: m.calendar_deleted({ description: entryLabel(entry) }),
      // A deleted row keeps its id, so the entry comes back as a new one.
      undo: () => {
        const id = newId()
        const { description, ticket, projectId, startedAt, stoppedAt } = entry
        createEntry.mutate({ id, description, ticket, projectId, startedAt, stoppedAt }, handlers)
        flash(id)
      },
    })
  }

  let body: HTMLDivElement | undefined
  let scroller: HTMLDivElement | undefined
  const drag = createGridDrag({
    body: () => body,
    zone,
    blocked: () => !!editor(),
    findEntry,
    onSlot: openSlot,
    onChange(entry, patch, verb, key) {
      // An entry a key moved keeps focus, on the day it moved to.
      if (key) {
        follow((patch.startedAt ?? entry.startedAt).getTime())
        focusEntry(entry.id)
      }
      change(entry, patch, verb)
    },
    onStatus: setStatus,
  })

  function click(event: MouseEvent) {
    const block = (event.target as HTMLElement).closest<HTMLElement>('[data-entry]')
    const entry = block && findEntry(block.dataset.entry)
    if (!entry || drag.suppressesClick() || entry.id === editingId()) return
    openEntry(entry, block)
  }

  // The slot being dragged, or the new one the popover is open for, on one day.
  function ghostOn(date: IsoDate) {
    const state = drag.state()
    const range = state?.active ? state.range : undefined
    const slot = range ?? draftRange()
    if (!slot) return null
    const stoppedAt = Math.max(slot.stoppedAt, slot.startedAt + SNAP_MINUTES * MINUTE)
    const [piece] = piecesOn(
      [{ id: 'ghost', startedAt: new Date(slot.startedAt), stoppedAt: new Date(stoppedAt) }],
      date,
      zone(),
      now(),
    )
    if (!piece) return null
    const projectId = range ? findEntry(state?.entryId)?.projectId : draft()?.projectId
    return {
      top: piece.top,
      bottom: piece.bottom,
      color:
        range && !state?.entryId
          ? undefined
          : blockProject(props.projects, projectId ?? null).color,
      invalid: !!range?.error,
      text: range?.error
        ? DROP_ERRORS[range.error].ghost()
        : `${formatRange(formatTime, slot.startedAt, slot.stoppedAt)} · ${formatHours(slot.stoppedAt - slot.startedAt)}`,
      draft: !range && piece.first,
    }
  }
  function draftRange() {
    const slot = draft()
    return slot && { startedAt: slot.startedAt.getTime(), stoppedAt: slot.stoppedAt.getTime() }
  }

  // Where the grid's now line and hatched future start on the day, or null when the day is past.
  function nowTop(date: IsoDate) {
    const start = startOfDay(date, zone())
    const end = startOfDay(addDays(date, 1), zone())
    if (now() >= end) return null
    return Math.max(0, (now() - start) / MINUTE) * (HOUR_PX / 60)
  }

  const scrolled = createOpeningScroll({
    scroller: () => scroller,
    body: () => body,
    week: () => (weekEntries.data && !weekEntries.isPlaceholderData ? week() : null),
    minute: () => openingMinute(columns().flatMap((date) => placed().get(date) ?? [])),
  })

  function atToday() {
    return week() === thisWeek() && (!narrow() || shownDay() === today())
  }

  return (
    <Card
      role="region"
      class="flex min-w-0 flex-col overflow-hidden"
      aria-labelledby="calendar-week"
      style={{ '--hour': `${HOUR_PX}px` }}
    >
      <CalendarHeader
        week={week()}
        today={today()}
        atToday={atToday()}
        total={weekTotal()}
        weekendShown={weekendShown()}
        weekendForced={weekendTime()}
        dates={dates()}
        columns={columns()}
        shownDay={shownDay()}
        totalFor={totalFor}
        onPrevious={() => goToWeek(addDays(week(), -7))}
        onNext={() => goToWeek(addDays(week(), 7))}
        onToday={() => goToWeek(thisWeek(), today())}
        onWeekend={(shown) => saveSettings.mutate({ calendarWeekend: shown }, handlers)}
        onDay={setDay}
      />
      <div
        ref={scroller}
        class="h-[max(24rem,min(40rem,calc(100dvh-17rem)))] overflow-y-auto overscroll-contain"
        onScroll={scrolled}
      >
        <div
          ref={body}
          class="cal-cols"
          style={{ '--days': columns().length }}
          onPointerDown={drag.pointerDown}
          onPointerMove={drag.pointerMove}
          onPointerUp={drag.pointerUp}
          onPointerCancel={drag.cancel}
          onKeyDown={drag.keyDown}
          onClick={click}
        >
          <div class="relative" aria-hidden="true">
            <For each={HOURS}>
              {(hour) => (
                <span
                  class="text-muted-foreground absolute right-2 -translate-y-1/2 text-[11px] tabular-nums"
                  style={{ top: `${hour * HOUR_PX}px` }}
                >
                  {hourLabel(hour)}
                </span>
              )}
            </For>
          </div>
          <For each={columns()}>
            {(date) => (
              <div
                class="cal-day"
                role="group"
                data-date={date}
                data-today={date === today() ? '' : undefined}
                aria-label={formatIsoDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}
              >
                <Show when={nowTop(date) !== null}>
                  <div class="cal-future" style={{ top: `${nowTop(date)}px` }} />
                </Show>
                <For each={keysOn(date)}>
                  {(key) => (
                    <Show
                      when={placed()
                        .get(date)
                        ?.find((p) => p.key === key)}
                    >
                      {(piece) => (
                        <CalendarBlock
                          piece={piece()}
                          projects={props.projects}
                          formatTime={formatTime}
                          now={now()}
                          editing={editingId() === piece().entry.id}
                          dragging={
                            !!drag.state()?.active && drag.state()?.entryId === piece().entry.id
                          }
                          flash={flashId() === piece().entry.id}
                          focus={focusId() === piece().entry.id}
                          onFocused={() => setFocusId(null)}
                        />
                      )}
                    </Show>
                  )}
                </For>
                <Show when={ghostOn(date)}>
                  {(ghost) => (
                    <CalendarGhost {...ghost()} ref={(el) => ghost().draft && setAnchor(el)} />
                  )}
                </Show>
                <Show when={date === today() && nowTop(date) !== null}>
                  <div class="cal-now" style={{ top: `${nowTop(date)}px` }} />
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
      <CalendarStatus status={status()} onUndo={undo} />
      <EntryPopover
        target={editor()?.target ?? null}
        anchor={anchor()}
        position="beside"
        zone={zone()}
        weekStart={weekStart()}
        projects={props.projects}
        entries={props.recent}
        issueLinks={props.issueLinks}
        returnFocus={() => returnTo?.()}
        onSave={save}
        onDelete={remove}
        onClose={() => {
          drag.closed()
          setEditor(null)
        }}
      />
    </Card>
  )
}
