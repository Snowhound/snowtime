// The Timer page's week calendar (prototypes/calendar.html; docs/architecture.md, "Timer
// calendar"): the user's entries of the shown week in their zone. A click or a drag on empty
// time adds an entry in the entry popover; dragging an entry or its edges, or Alt+arrow keys on
// it, move it or change its times; a click or Enter edits it. Each change is one optimistic
// mutation (../queries.ts), and the status line under the grid names it with an Undo.
import { keepPreviousData, useQuery } from '@tanstack/solid-query'
import ChevronLeftIcon from 'lucide-solid/icons/chevron-left'
import ChevronRightIcon from 'lucide-solid/icons/chevron-right'
import Undo2Icon from 'lucide-solid/icons/undo-2'
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Toggle } from '~/components/ui/toggle'
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
import { formatDateTime, formatIsoDate, formatIsoDateRange } from '~/lib/format'
import type { Project } from '~/lib/queries/projects'
import { newId } from '~/lib/queries/query'
import { type Settings, useUpdateSettings } from '~/lib/queries/settings'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { UpdateEntryInput } from '~/server/entries/entries.schemas'
import { entryName } from '../entries'
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
import { CalendarBlock, CalendarGhost, HOUR_PX, blockProject } from './calendar-block'
import {
  DAY_MINUTES,
  type Drag,
  type DragError,
  type DragRange,
  type Range,
  SNAP_MINUTES,
  type Slot,
  addRange,
  clickRange,
  dragRange,
  isWeekend,
  nudge,
  openingMinute,
  piecesOn,
  sideBySide,
  totalOn,
  weekDates,
} from './week-grid'

const MINUTE = 60_000
// The now line and the hatched future move this often.
const TICK_MS = 30_000
// A pointer that moves less than this is a click, not a drag.
const DRAG_PX = 4
const FLASH_MS = 1400
// How long an entry a key moved keeps focus through the page's redraws.
const KEEP_FOCUS_MS = 1500
const HOURS = Array.from({ length: 23 }, (_, i) => i + 1)

const KEYS: Record<string, { minutes: number } | { days: number }> = {
  ArrowUp: { minutes: -SNAP_MINUTES },
  ArrowDown: { minutes: SNAP_MINUTES },
  ArrowLeft: { days: -1 },
  ArrowRight: { days: 1 },
}

const DROP_ERRORS: Record<DragError, { ghost: () => string; status: () => string }> = {
  future: { ghost: m.entry_error_future, status: m.calendar_error_future },
  add_future: { ghost: m.calendar_add_up_to_now, status: m.calendar_error_add_future },
}

const VERBS = {
  moved: m.calendar_moved,
  changed: m.calendar_changed,
  updated: m.calendar_updated,
}

type Patch = Omit<UpdateEntryInput, 'id'>

interface DragState {
  drag: Drag
  entryId?: string
  x: number
  y: number
  touch: boolean
  active: boolean
  range?: DragRange
}

interface Status {
  text: string
  error?: boolean
  undo?: () => void
}

function weekday(date: IsoDate) {
  return formatIsoDate(date, { weekday: 'short' })
}

function dayOfMonth(date: IsoDate) {
  return formatIsoDate(date, { day: 'numeric' })
}

function name(entry: { description: string; ticket: string | null }) {
  return entryName(entry) || m.timer_no_description()
}

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
  // The weekend shows when the user turned it on, or when the week has time on it.
  const weekendTime = createMemo(
    () => totalOn(entries(), days().filter(isWeekend), zone(), now()) > 0,
  )
  function weekendShown() {
    return props.settings.calendarWeekend || weekendTime()
  }
  const dates = createMemo(() => days().filter((d) => weekendShown() || !isWeekend(d)))
  function shownDay() {
    return dates().includes(day()) ? day() : dates()[0]
  }
  const columns = createMemo(() => (narrow() ? [shownDay()] : dates()))

  const placed = createMemo(
    () =>
      new Map(days().map((date) => [date, sideBySide(piecesOn(entries(), date, zone(), now()))])),
  )
  const pieces = createMemo(() => new Map([...placed().values()].flat().map((p) => [p.key, p])))
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

  function formatTime(ms: number) {
    const cycle = hourCycle()
    return formatDateTime(ms, zone(), {
      hour: cycle === 'h23' ? '2-digit' : 'numeric',
      minute: '2-digit',
      hourCycle: cycle,
    })
  }
  function hourLabel(hour: number) {
    const cycle = hourCycle()
    return formatDateTime(Date.UTC(2000, 0, 1, hour), 'UTC', {
      hour: cycle === 'h23' ? '2-digit' : 'numeric',
      minute: '2-digit',
      hourCycle: cycle,
    })
  }
  function when(startedAt: number, stoppedAt: number | null) {
    const end = stoppedAt === null ? m.calendar_now() : formatTime(stoppedAt)
    return `${formatDateTime(startedAt, zone(), { weekday: 'short' })} ${formatTime(startedAt)}–${end}`
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
    const before: Patch = {}
    for (const key of Object.keys(patch) as (keyof Patch)[]) {
      Object.assign(before, { [key]: entry[key] })
    }
    updateEntry.mutate({ id: entry.id, ...patch }, handlers)
    const startedAt = (patch.startedAt ?? entry.startedAt).getTime()
    const stoppedAt = (patch.stoppedAt ?? entry.stoppedAt)?.getTime() ?? null
    setStatus({
      text: VERBS[verb]({
        description: name({ ...entry, ...patch }),
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
  // When the popover last closed on a click outside, which shouldn't also add time.
  let closedAt = 0

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
    let before: Entry | undefined
    for (const e of [...props.recent, ...entries()]) {
      const end = e.stoppedAt?.getTime()
      if (
        end !== undefined &&
        end <= slot.startedAt &&
        (!before || end > before.stoppedAt!.getTime())
      ) {
        before = e
      }
    }
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
          description: name(values),
          when: when(values.startedAt.getTime(), stoppedAt.getTime()),
        }),
        undo: () => deleteEntry.mutate({ id }, handlers),
      })
      flash(id)
      return
    }
    const entry = target.entry
    const patch: Patch = {}
    if (values.description !== entry.description) patch.description = values.description
    if (values.ticket !== entry.ticket) patch.ticket = values.ticket
    if (values.projectId !== entry.projectId) patch.projectId = values.projectId
    if (values.startedAt.getTime() !== entry.startedAt.getTime()) patch.startedAt = values.startedAt
    if (values.stoppedAt && values.stoppedAt.getTime() !== entry.stoppedAt?.getTime()) {
      patch.stoppedAt = values.stoppedAt
    }
    if (Object.keys(patch).length > 0) change(entry, patch, 'updated')
  }

  function remove(entry: StoppedEntry) {
    setEditor(null)
    deleteEntry.mutate({ id: entry.id }, handlers)
    setStatus({
      text: m.calendar_deleted({ description: name(entry) }),
      // A deleted row keeps its id, so the entry comes back as a new one.
      undo: () => {
        const id = newId()
        const { description, ticket, projectId, startedAt, stoppedAt } = entry
        createEntry.mutate({ id, description, ticket, projectId, startedAt, stoppedAt }, handlers)
        flash(id)
      },
    })
  }

  // Dragging with a mouse or pen: on empty time to add, on an entry to move it, on its top or
  // bottom edge to change its start or end. On touch a tap adds or edits and dragging scrolls.
  let body: HTMLDivElement | undefined
  let scroller: HTMLDivElement | undefined
  const [dragState, setDragState] = createSignal<DragState | null>(null)
  // The click that ends a drag isn't an edit.
  let suppressClick = false

  function slotAt(x: number, y: number): Slot {
    const cols = [...body!.querySelectorAll<HTMLElement>('[data-date]')]
    const col =
      cols.find((c) => {
        const r = c.getBoundingClientRect()
        return x >= r.left && x < r.right
      }) ?? (x < cols[0].getBoundingClientRect().left ? cols[0] : cols.at(-1)!)
    const minutes = ((y - col.getBoundingClientRect().top) / HOUR_PX) * 60
    return { date: col.dataset.date!, minutes: Math.max(0, Math.min(DAY_MINUTES, minutes)) }
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || editor() || Date.now() - closedAt < 300) return
    const target = event.target as HTMLElement
    const block = target.closest<HTMLElement>('[data-entry]')
    const touch = event.pointerType === 'touch'
    let drag: Drag
    let entryId: string | undefined
    if (block) {
      const entry = findEntry(block.dataset.entry)
      const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle
      const kind = handle === 'start' || handle === 'end' ? handle : 'move'
      // A running entry ends at now, so only its start moves.
      if (!entry || touch || (kind === 'move' && !entry.stoppedAt)) return
      drag = {
        kind,
        from: slotAt(event.clientX, event.clientY),
        startedAt: entry.startedAt.getTime(),
        stoppedAt: entry.stoppedAt?.getTime() ?? null,
      }
      entryId = entry.id
    } else if (target.closest('[data-date]')) {
      drag = { kind: 'create', from: slotAt(event.clientX, event.clientY) }
    } else return
    setDragState({ drag, entryId, x: event.clientX, y: event.clientY, touch, active: false })
    // No text selection while dragging. The pointer is captured once the drag starts, so a
    // plain click still reaches the entry.
    if (!touch) event.preventDefault()
  }

  function pointerMove(event: PointerEvent) {
    const state = dragState()
    if (!state || state.touch) return
    if (!state.active && Math.hypot(event.clientX - state.x, event.clientY - state.y) < DRAG_PX) {
      return
    }
    if (!state.active) body?.setPointerCapture?.(event.pointerId)
    const to = slotAt(event.clientX, event.clientY)
    setDragState({ ...state, active: true, range: dragRange(state.drag, to, zone(), Date.now()) })
  }

  function pointerUp() {
    const state = dragState()
    setDragState(null)
    if (!state) return
    if (!state.active) {
      // A click on an entry opens it through the button's click.
      if (state.drag.kind !== 'create') return
      const slot = clickRange(state.drag.from, zone(), Date.now())
      if (slot) openSlot(slot)
      else setStatus({ text: m.calendar_add_up_to_now() })
      return
    }
    suppressClick = true
    setTimeout(() => (suppressClick = false))
    const { range, drag } = state
    if (!range) return
    if (range.error) {
      setStatus({ text: DROP_ERRORS[range.error].status(), error: true })
      return
    }
    if (drag.kind === 'create') {
      openSlot(range)
      return
    }
    const entry = findEntry(state.entryId)
    if (!entry) return
    const patch: Patch = {}
    if (range.startedAt !== entry.startedAt.getTime()) patch.startedAt = new Date(range.startedAt)
    if (entry.stoppedAt && range.stoppedAt !== entry.stoppedAt.getTime()) {
      patch.stoppedAt = new Date(range.stoppedAt)
    }
    if (Object.keys(patch).length > 0)
      change(entry, patch, drag.kind === 'move' ? 'moved' : 'changed')
  }

  function click(event: MouseEvent) {
    const block = (event.target as HTMLElement).closest<HTMLElement>('[data-entry]')
    const entry = block && findEntry(block.dataset.entry)
    if (!entry || suppressClick) return
    openEntry(entry, block)
  }

  // After each write the page may briefly re-insert its nodes, which drops focus (task 070), so
  // an entry a key just moved gets it back.
  let keptFocus: { id: string; until: number } | null = null
  function focusOut(event: FocusEvent) {
    const id = (event.target as HTMLElement).dataset.entry
    if (!keptFocus || id !== keptFocus.id || event.relatedTarget) return
    queueMicrotask(refocus)
  }
  // Until the block is back in the page, on the next frames.
  function refocus() {
    if (!keptFocus || Date.now() > keptFocus.until) return
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    const block = body?.querySelector<HTMLElement>(`[data-entry="${keptFocus.id}"]`)
    if (block?.isConnected) block.focus()
    else requestAnimationFrame(refocus)
  }

  // Alt+Up and Alt+Down move a focused entry by 15 minutes and Alt+Left and Alt+Right by a
  // day; with Shift, Alt+Up and Alt+Down change its end. Alt+Left is the browser's Back on
  // Windows and Linux, so the page keeps it on an entry.
  function keyDown(event: KeyboardEvent) {
    const block = (event.target as HTMLElement).closest<HTMLElement>('[data-entry]')
    const key = KEYS[event.key]
    if (!block || !event.altKey || !key) return
    event.preventDefault()
    const entry = findEntry(block.dataset.entry)
    if (!entry) return
    const times = {
      startedAt: entry.startedAt.getTime(),
      stoppedAt: entry.stoppedAt?.getTime() ?? null,
    }
    const result = nudge(times, { ...key, end: event.shiftKey }, zone(), Date.now())
    if (!result) return
    if (result.error) {
      setStatus({ text: DROP_ERRORS.future.status(), error: true })
      return
    }
    const patch: Patch = {}
    if (result.startedAt !== undefined && result.startedAt !== times.startedAt) {
      patch.startedAt = new Date(result.startedAt)
    }
    if (result.stoppedAt !== undefined && result.stoppedAt !== times.stoppedAt) {
      patch.stoppedAt = new Date(result.stoppedAt)
    }
    if (Object.keys(patch).length === 0) return
    follow(result.startedAt ?? times.startedAt)
    focusEntry(entry.id)
    keptFocus = { id: entry.id, until: Date.now() + KEEP_FOCUS_MS }
    change(entry, patch, event.shiftKey ? 'changed' : 'moved')
  }

  // The slot being dragged, or the new one the popover is open for, on one day.
  function ghostOn(date: IsoDate) {
    const state = dragState()
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
        : `${formatTime(slot.startedAt)}–${formatTime(slot.stoppedAt)} · ${formatHours(slot.stoppedAt - slot.startedAt)}`,
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

  // The week opens at 07:00, or earlier when its first entry starts before; once per week. The
  // position is kept until the user scrolls: in development the grid can scroll only once the
  // styles load, and Solid may move the page's nodes after hydration, which resets it.
  let scrolledWeek: IsoDate | null = null
  let opening: number | null = null
  function applyOpening() {
    if (opening === null || !scroller) return
    const max = scroller.scrollHeight - scroller.clientHeight
    if (max <= 0) return
    opening = Math.min(opening, max)
    scroller.scrollTop = opening
  }
  function scrolled() {
    if (opening !== null && scroller && Math.abs(scroller.scrollTop - opening) > 1) {
      if (scroller.scrollHeight > scroller.clientHeight) opening = null
    }
  }
  createEffect(() => {
    const shown = week()
    if (!weekEntries.data || weekEntries.isPlaceholderData || scrolledWeek === shown) return
    scrolledWeek = shown
    const first = openingMinute(columns().flatMap((date) => placed().get(date) ?? []))
    // A little above the hour, so its label shows.
    opening = Math.max(0, (first / 60) * HOUR_PX - 10)
    applyOpening()
  })
  onMount(() => {
    if (typeof ResizeObserver === 'undefined' || !body) return
    const resized = new ResizeObserver(applyOpening)
    resized.observe(body)
    const moved = new MutationObserver(applyOpening)
    moved.observe(document.body, { childList: true })
    onCleanup(() => {
      resized.disconnect()
      moved.disconnect()
    })
  })

  function weekLabel() {
    return formatIsoDateRange(week(), addDays(week(), 6), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }
  function onToday() {
    return week() === thisWeek() && (!narrow() || shownDay() === today())
  }

  return (
    <Card
      role="region"
      class="flex min-w-0 flex-col overflow-hidden"
      aria-labelledby="calendar-week"
      style={{ '--hour': `${HOUR_PX}px` }}
    >
      <div class="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-4">
        <div class="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            class="size-8"
            aria-label={m.calendar_previous_week()}
            onClick={() => goToWeek(addDays(week(), -7))}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="size-8"
            aria-label={m.calendar_next_week()}
            onClick={() => goToWeek(addDays(week(), 7))}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="h-8"
          disabled={onToday()}
          onClick={() => goToWeek(thisWeek(), today())}
        >
          {m.timer_today()}
        </Button>
        <h2 id="calendar-week" class="ml-1 font-medium" aria-live="polite">
          {weekLabel()}
        </h2>
        <div class="ml-auto flex items-center gap-3">
          <span class="text-muted-foreground text-sm tabular-nums">
            {weekTotal() ? m.calendar_week_total({ total: formatHours(weekTotal()) }) : ''}
          </span>
          <Toggle
            variant="outline"
            size="sm"
            pressed={weekendShown()}
            disabled={weekendTime()}
            title={weekendTime() ? m.calendar_weekend_forced() : undefined}
            onChange={(pressed) => saveSettings.mutate({ calendarWeekend: pressed }, handlers)}
          >
            {m.calendar_weekend()}
          </Toggle>
        </div>
      </div>
      <div
        class="flex gap-1 overflow-x-auto border-b px-2 py-1.5 sm:hidden"
        role="group"
        aria-label={m.calendar_day()}
      >
        <For each={dates()}>
          {(date) => (
            <button
              type="button"
              aria-pressed={date === shownDay()}
              class={cn(
                'flex min-w-11 flex-1 flex-col items-center rounded-md px-1 py-1 text-xs',
                date === shownDay()
                  ? 'bg-primary text-primary-foreground'
                  : date === today()
                    ? 'bg-accent'
                    : 'hover:bg-accent',
              )}
              onClick={() => setDay(date)}
            >
              <span>{weekday(date)}</span>
              <span class="text-sm font-medium tabular-nums">{dayOfMonth(date)}</span>
              <span class={cn('tabular-nums', date !== shownDay() && 'text-muted-foreground')}>
                {totalFor(date) ? formatHours(totalFor(date)) : '·'}
              </span>
            </button>
          )}
        </For>
      </div>
      <div
        class="cal-cols overflow-y-hidden border-b max-sm:hidden"
        style={{ '--days': columns().length }}
      >
        <div />
        <For each={columns()}>
          {(date) => (
            <div
              class={cn(
                'flex items-baseline justify-between gap-1 border-l px-2 py-1.5',
                date === today() && 'bg-accent/60',
              )}
            >
              <span
                class={cn('truncate text-sm', date === today() ? 'font-semibold' : 'font-medium')}
              >
                {weekday(date)} {dayOfMonth(date)}
              </span>
              <span class="text-muted-foreground text-xs tabular-nums">
                {totalFor(date) ? formatHours(totalFor(date)) : ''}
              </span>
            </div>
          )}
        </For>
      </div>
      <div
        ref={scroller}
        class="h-[max(24rem,min(40rem,calc(100dvh-17rem)))] overflow-y-auto overscroll-contain"
        onScroll={scrolled}
      >
        <div
          ref={body}
          class="cal-cols"
          style={{ '--days': columns().length }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={() => setDragState(null)}
          onClick={click}
          onKeyDown={keyDown}
          onFocusOut={focusOut}
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
                    <Show when={pieces().get(key)}>
                      {(piece) => (
                        <CalendarBlock
                          piece={piece()}
                          projects={props.projects}
                          formatTime={formatTime}
                          now={now()}
                          editing={editingId() === piece().entry.id}
                          dragging={
                            !!dragState()?.active && dragState()?.entryId === piece().entry.id
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
      <div class="flex min-h-10 items-center justify-between gap-3 border-t px-3 py-1.5 text-sm sm:px-4">
        <p
          class={cn(
            'flex min-w-0 flex-wrap items-center gap-x-2',
            status()?.error ? 'text-destructive' : 'text-muted-foreground',
          )}
          role="status"
        >
          <span>{status()?.text}</span>
          <Show when={status()?.undo}>
            <Button variant="link" size="sm" class="h-auto gap-1 p-0" onClick={undo}>
              <Undo2Icon aria-hidden="true" />
              {m.calendar_undo()}
            </Button>
          </Show>
        </p>
        <p class="text-muted-foreground hidden shrink-0 text-xs md:block">{m.calendar_hint()}</p>
      </div>
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
          closedAt = Date.now()
          setEditor(null)
        }}
      />
    </Card>
  )
}
