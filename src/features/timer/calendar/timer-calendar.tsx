// The Timer page's week calendar (prototypes/calendar.html; docs/architecture/timer.md, "Timer
// calendar"): the user's entries of the shown week in their zone. A click or a drag on empty
// time adds an entry in the entry popover; dragging an entry or its edges, or Alt+arrow keys on
// it, move it or change its times; a click or Enter edits it. Alt+drag, Duplicate, and the
// context menus on an entry and on empty time copy and paste it (prototypes/copy-entries.html).
// Each change is one optimistic mutation (../queries.ts), and the status line under the grid
// names it with an Undo.
import { keepPreviousData } from '@tanstack/solid-query'
import ClipboardPasteIcon from 'lucide-solid/icons/clipboard-paste'
import CopyIcon from 'lucide-solid/icons/copy'
import CopyPlusIcon from 'lucide-solid/icons/copy-plus'
import PencilIcon from 'lucide-solid/icons/pencil'
import PlusIcon from 'lucide-solid/icons/plus'
import RepeatIcon from 'lucide-solid/icons/repeat'
import TrashIcon from 'lucide-solid/icons/trash'
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
import { formatDateTime, formatIsoDate, formatIsoDateRange } from '~/lib/format'
import { userRegion } from '~/lib/holidays/region'
import type { Project } from '~/lib/queries/projects'
import { newId } from '~/lib/queries/query'
import { isPendingChange, usePendingChanges } from '~/lib/queries/refusal'
import { type Settings, useUpdateSettings } from '~/lib/queries/settings'
import { useQuery } from '~/lib/queries/use-query'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { UpdateEntryInput } from '~/server/entries/entries.schemas'
import { type Pattern, monthDayName, weekdayName } from '../copy-panel/copy-days'
import { changedFields, entryLabel, lastEnded } from '../entries'
import { EntryPopover, type EntryPopoverTarget, type EntryPopoverValues } from '../entry-popover'
import {
  type Entry,
  type RunningTimer,
  type StoppedEntry,
  entriesQuery,
  useCreateEntries,
  useCreateEntry,
  useDeleteEntries,
  useDeleteEntry,
  useUpdateEntry,
} from '../queries'
import { CalendarBlock, CalendarGhost, HOUR_PX, blockProject, formatRange } from './calendar-block'
import { CalendarHeader } from './calendar-header'
import { CalendarStatus, type Status } from './calendar-status'
import { DROP_ERRORS, createGridDrag } from './grid-drag'
import { createOpeningScroll } from './opening-scroll'
import { type MenuItem, PointMenu, copyKeys, isCopyKey } from './point-menu'
import {
  CLICK_MINUTES,
  type Range,
  SNAP_MINUTES,
  addRange,
  instantAt,
  isWeekend,
  openingMinute,
  piecesOn,
  sideBySide,
  weekDates,
} from './week-grid'

const MINUTE = 60_000
// The now line moves this often.
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
// What an entry is about, which its copies share.
type Work = Pick<Entry, 'description' | 'ticket' | 'projectId'>
// An entry copied from a menu or with ⌘C, kept in the page rather than the system clipboard.
type Copied = Work & { length: number }
// A context menu at a point: an entry's, or empty time's starting at `start`.
type Menu = { x: number; y: number } & ({ entry: Entry } | { start: number })

// The entry's values of the fields a patch changes.
function before(entry: Entry, patch: Patch): Patch {
  return Object.fromEntries(Object.keys(patch).map((key) => [key, entry[key as keyof Patch]]))
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
  function slotTitle(start: number) {
    const day = formatDateTime(start, zone(), { weekday: 'short', day: 'numeric', month: 'short' })
    return `${day}, ${formatTime(start)}`
  }
  function when(startedAt: number, stoppedAt: number | null) {
    const weekday = formatDateTime(startedAt, zone(), { weekday: 'short' })
    return `${weekday} ${formatRange(formatTime, startedAt, stoppedAt)}`
  }

  // oxlint-disable-next-line solid/reactivity -- the page renders a new view per organization.
  const keys = { organizationId: props.organizationId }
  const updateEntry = useUpdateEntry(keys)
  const createEntry = useCreateEntry(keys)
  const createEntries = useCreateEntries(keys)
  const deleteEntry = useDeleteEntry(keys)
  const deleteEntries = useDeleteEntries(keys)
  const saveSettings = useUpdateSettings()

  const [status, setStatus] = createSignal<Status | null>(null)
  // A change the busy server refused stays on the grid; the status line says it's pending.
  const pending = usePendingChanges()
  function failed(error: unknown) {
    if (isPendingChange(error)) setStatus(null)
    else setStatus({ text: m.entry_save_failed({ error: errorMessage(error) }), error: true })
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

  // Changed entries flash.
  const [flashIds, setFlashIds] = createSignal<ReadonlySet<string>>(new Set())
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
  function flash(...ids: string[]) {
    setFlashIds(new Set<string>())
    clearTimeout(flashTimer)
    requestAnimationFrame(() => setFlashIds(new Set(ids)))
    flashTimer = setTimeout(() => setFlashIds(new Set<string>()), FLASH_MS)
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
    const old = before(entry, patch)
    updateEntry.mutate({ id: entry.id, ...patch }, handlers)
    const startedAt = (patch.startedAt ?? entry.startedAt).getTime()
    const stoppedAt = (patch.stoppedAt ?? entry.stoppedAt)?.getTime() ?? null
    setStatus({
      text: VERBS[verb]({
        description: entryLabel({ ...entry, ...patch }),
        when: when(startedAt, stoppedAt),
      }),
      undo: () => {
        updateEntry.mutate({ id: entry.id, ...old }, handlers)
        follow(entry.startedAt.getTime())
        focusEntry(entry.id)
      },
    })
    flash(entry.id)
  }

  // "Tue 09:00–10:30" for one entry, "5 days, 6–12 Oct" for more.
  function daysText(spans: readonly Range[]) {
    if (spans.length === 1) return when(spans[0].startedAt, spans[0].stoppedAt)
    const dates = spans.map((s) => localDate(s.startedAt, zone())).sort()
    const range = formatIsoDateRange(dates[0], dates.at(-1)!, { day: 'numeric', month: 'short' })
    return m.calendar_days({ count: spans.length, range })
  }

  // One createEntries of the work at each time, with an Undo that deletes them all and runs
  // `alsoUndo` for what else the change did. Returns the new ids.
  function addEntries(work: Work, spans: readonly Range[], text: string, alsoUndo?: () => void) {
    const entries = spans.map((s) => ({
      id: newId(),
      startedAt: new Date(s.startedAt),
      stoppedAt: new Date(s.stoppedAt),
    }))
    const ids = entries.map((e) => e.id)
    const { description, ticket, projectId } = work
    createEntries.mutate({ description, ticket, projectId, entries }, handlers)
    setStatus({
      text,
      undo: () => {
        alsoUndo?.()
        deleteEntries.mutate({ ids }, handlers)
      },
    })
    flash(...ids)
    return ids
  }

  // A copy beside the original, at the same time, so a drag or Alt+arrows moves it to its day.
  // It takes focus once it shows.
  function duplicate(entry: StoppedEntry) {
    const span = { startedAt: entry.startedAt.getTime(), stoppedAt: entry.stoppedAt.getTime() }
    const [id] = addEntries(
      entry,
      [span],
      m.calendar_duplicated({ description: entryLabel(entry) }),
    )
    returnTo = () => body?.querySelector<HTMLElement>(`[data-entry="${id}"]`)
    setEditor(null)
    focusEntry(id)
    return id
  }

  const [copied, setCopied] = createSignal<Copied | null>(null)
  function copyEntry(entry: StoppedEntry) {
    const { description, ticket, projectId } = entry
    const length = entry.stoppedAt.getTime() - entry.startedAt.getTime()
    setCopied({ description, ticket, projectId, length })
    setStatus({
      text: m.calendar_copied({ description: entryLabel(entry), duration: formatHours(length) }),
    })
  }

  function pasteHere(clip: Copied, start: number) {
    const span = { startedAt: start, stoppedAt: start + clip.length }
    const text = m.calendar_pasted({
      description: entryLabel(clip),
      when: when(span.startedAt, span.stoppedAt),
    })
    focusEntry(addEntries(clip, [span], text)[0])
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
  function draftSlot() {
    const target = editor()?.target
    return target?.kind === 'new' ? target.slot : undefined
  }

  // A new slot takes the project of the entry that ended last before it; a paste that repeats
  // takes the copied work and fills the copy panel by its pattern.
  function openSlot(slot: Range, button?: HTMLElement, paste?: { work: Work; copy: Pattern }) {
    const last = lastEnded([...props.recent, ...entries()], { before: slot.startedAt })
    returnTo = () => button
    setEditor({
      target: {
        kind: 'new',
        slot: {
          startedAt: new Date(slot.startedAt),
          stoppedAt: new Date(slot.stoppedAt),
          projectId: paste ? paste.work.projectId : (last?.projectId ?? null),
          description: paste?.work.description,
          ticket: paste?.work.ticket,
        },
        copy: paste?.copy,
      },
      button,
    })
  }

  function openEntry(entry: Entry, block: HTMLElement, copy?: true) {
    returnTo = () => body?.querySelector<HTMLElement>(`[data-entry="${entry.id}"]`)
    setAnchor(block)
    setEditor({
      target: entry.stoppedAt
        ? { kind: 'edit', entry: entry as StoppedEntry, copy }
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

  function save({ copies, ...values }: EntryPopoverValues) {
    const target = editor()?.target
    setEditor(null)
    if (!target) return
    follow(values.startedAt.getTime())
    const spans = copies.map((c) => ({
      startedAt: c.startedAt.getTime(),
      stoppedAt: c.stoppedAt.getTime(),
    }))
    const description = entryLabel(values)
    if (target.kind === 'new' && spans.length) {
      const all = [
        { startedAt: values.startedAt.getTime(), stoppedAt: values.stoppedAt!.getTime() },
        ...spans,
      ]
      addEntries(values, all, m.calendar_added_copies({ description, days: daysText(all) }))
      return
    }
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
    if (!spans.length) {
      if (patch) change(entry, patch, 'updated')
      return
    }
    // The edit and the copies go back with one Undo.
    const old = patch && before(entry, patch)
    if (patch) updateEntry.mutate({ id: entry.id, ...patch }, handlers)
    const ids = addEntries(
      values,
      spans,
      m.calendar_saved_copies({ description, days: daysText(spans) }),
      old ? () => updateEntry.mutate({ id: entry.id, ...old }, handlers) : undefined,
    )
    flash(entry.id, ...ids)
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
    onCopy(entry, range) {
      const text = m.calendar_copied_to({ description: entryLabel(entry), days: daysText([range]) })
      addEntries(entry, [range], text)
    },
    onStatus: setStatus,
  })

  // ⌘C or Ctrl+C copies a focused entry; Alt+arrows move it (grid-drag.ts).
  function keyDown(event: KeyboardEvent) {
    const block = (event.target as HTMLElement).closest<HTMLElement>('[data-entry]')
    if (block && isCopyKey(event)) {
      const entry = findEntry(block.dataset.entry)
      if (entry?.stoppedAt) copyEntry(entry as StoppedEntry)
      return
    }
    drag.keyDown(event)
  }

  // The context menus: a right-click, a two-finger click on a Mac trackpad, Ctrl+click on a
  // Mac, Shift+F10, or the Menu key; on touch, a long press (grid-drag.ts).
  const [menu, setMenu] = createSignal<Menu | null>(null)
  // The entry that takes focus when the entry menu closes without opening the popover.
  let menuFocus: string | null = null

  // From the keyboard the point isn't on the entry, so its menu opens under it.
  function openMenu(target: HTMLElement, x: number, y: number) {
    const block = target.closest<HTMLElement>('[data-entry]')
    const entry = block && findEntry(block.dataset.entry)
    if (block && entry) {
      const r = block.getBoundingClientRect()
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
      menuFocus = entry.id
      setMenu(inside ? { x, y, entry } : { x: r.left, y: r.bottom + 4, entry })
    } else if (!block && target.closest('[data-date]')) {
      const slot = drag.slotAt(x, y)
      const minutes = Math.floor(slot.minutes / SNAP_MINUTES) * SNAP_MINUTES
      setMenu({ x, y, start: instantAt(slot.date, minutes, zone()) })
    }
  }

  function contextMenu(event: MouseEvent) {
    const target = event.target as HTMLElement
    if (!target.closest('[data-entry], [data-date]')) return
    event.preventDefault()
    drag.cancel()
    setEditor(null)
    openMenu(target, event.clientX, event.clientY)
  }

  function blockOf(entry: Entry) {
    return body?.querySelector<HTMLElement>(`[data-entry="${entry.id}"]`) ?? undefined
  }

  function entryItems(entry: Entry): MenuItem[] {
    // The running entry has no end yet to copy.
    const stopped = entry.stoppedAt ? (entry as StoppedEntry) : null
    function edit(copy?: true) {
      const block = blockOf(entry)
      if (block) openEntry(entry, block, copy)
    }
    return [
      { label: m.menu_edit(), icon: <PencilIcon aria-hidden="true" />, onSelect: () => edit() },
      {
        label: m.menu_copy(),
        icon: <CopyIcon aria-hidden="true" />,
        shortcut: copyKeys(),
        disabled: !stopped,
        onSelect: () => stopped && copyEntry(stopped),
      },
      {
        label: m.menu_duplicate(),
        icon: <CopyPlusIcon aria-hidden="true" />,
        disabled: !stopped,
        onSelect: () => stopped && (menuFocus = duplicate(stopped)),
      },
      {
        label: m.menu_copy_days(),
        icon: <RepeatIcon aria-hidden="true" />,
        disabled: !stopped,
        onSelect: () => edit(true),
      },
      'separator',
      {
        label: m.timer_delete(),
        icon: <TrashIcon aria-hidden="true" />,
        destructive: true,
        disabled: !stopped,
        onSelect: () => {
          menuFocus = null
          if (stopped) remove(stopped)
        },
      },
    ]
  }

  function slotItems(start: number): MenuItem[] {
    const clip = copied()
    const date = localDate(start, zone())
    function repeat(copy: Pattern) {
      return () => {
        const pasted = copied()
        if (!pasted) return
        const { length, ...work } = pasted
        openSlot({ startedAt: start, stoppedAt: start + length }, undefined, { work, copy })
      }
    }
    const repeatIcon = <RepeatIcon aria-hidden="true" />
    return [
      {
        label: m.menu_add_here(),
        icon: <PlusIcon aria-hidden="true" />,
        onSelect: () => openSlot({ startedAt: start, stoppedAt: start + CLICK_MINUTES * MINUTE }),
      },
      'separator',
      {
        label: clip
          ? m.menu_paste_here({ description: entryLabel(clip) })
          : m.menu_paste_here_empty(),
        icon: <ClipboardPasteIcon aria-hidden="true" />,
        disabled: !clip,
        onSelect: () => {
          const pasted = copied()
          if (pasted) pasteHere(pasted, start)
        },
      },
      {
        label: m.menu_paste_workday(),
        icon: repeatIcon,
        disabled: !clip,
        onSelect: repeat('workday'),
      },
      {
        label: m.menu_paste_week({ weekday: weekdayName(date) }),
        icon: <RepeatIcon aria-hidden="true" />,
        disabled: !clip,
        onSelect: repeat('week'),
      },
      {
        label: m.menu_paste_month({ day: monthDayName(date) }),
        icon: <RepeatIcon aria-hidden="true" />,
        disabled: !clip,
        onSelect: repeat('month'),
      },
    ]
  }

  function slotHint() {
    const clip = copied()
    if (!clip) return m.menu_hint_empty({ keys: copyKeys() })
    const project = blockProject(props.projects, clip.projectId).name
    return m.menu_hint({ duration: formatHours(clip.length), project })
  }

  // Where a paste from the open menu would go, with the copied length.
  function menuRange() {
    const open = menu()
    if (!open || !('start' in open)) return undefined
    return {
      startedAt: open.start,
      stoppedAt: open.start + (copied()?.length ?? CLICK_MINUTES * MINUTE),
    }
  }

  function click(event: MouseEvent) {
    const block = (event.target as HTMLElement).closest<HTMLElement>('[data-entry]')
    const entry = block && findEntry(block.dataset.entry)
    if (!entry || drag.suppressesClick() || entry.id === editingId()) return
    openEntry(entry, block)
  }

  // The slot being dragged, the new one the popover is open for, or where a paste from the
  // menu would go, on one day.
  function ghostOn(date: IsoDate) {
    const state = drag.state()
    const range = state?.active ? state.range : undefined
    const draft = range ? undefined : draftRange()
    const pasting = range || draft ? undefined : menuRange()
    const slot = range ?? draft ?? pasting
    if (!slot) return null
    const stoppedAt = Math.max(slot.stoppedAt, slot.startedAt + SNAP_MINUTES * MINUTE)
    const [piece] = piecesOn(
      [{ id: 'ghost', startedAt: new Date(slot.startedAt), stoppedAt: new Date(stoppedAt) }],
      date,
      zone(),
      now(),
    )
    if (!piece) return null
    const projectId = range
      ? findEntry(state?.entryId)?.projectId
      : draft
        ? draftSlot()?.projectId
        : copied()?.projectId
    const times = `${formatRange(formatTime, slot.startedAt, slot.stoppedAt)} · ${formatHours(slot.stoppedAt - slot.startedAt)}`
    return {
      top: piece.top,
      bottom: piece.bottom,
      color:
        (range && !state?.entryId) || (pasting && !copied())
          ? undefined
          : blockProject(props.projects, projectId ?? null).color,
      invalid: !!range?.error,
      text: range?.error
        ? DROP_ERRORS[range.error].ghost()
        : state?.copy
          ? m.calendar_copy_ghost({ times })
          : times,
      draft: !!draft && piece.first,
    }
  }
  function draftRange() {
    const slot = draftSlot()
    return slot && { startedAt: slot.startedAt.getTime(), stoppedAt: slot.stoppedAt.getTime() }
  }

  // Where the grid's now line is on the day, or null when the day is past.
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
          class={cn('cal-cols', drag.state()?.copy && 'cursor-copy')}
          style={{ '--days': columns().length }}
          onPointerDown={drag.pointerDown}
          onPointerMove={drag.pointerMove}
          onPointerUp={drag.pointerUp}
          onPointerCancel={drag.cancel}
          onKeyDown={keyDown}
          onContextMenu={contextMenu}
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
                            !!drag.state()?.active &&
                            !drag.state()?.copy &&
                            drag.state()?.entryId === piece().entry.id
                          }
                          flash={flashIds().has(piece().entry.id)}
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
      <CalendarStatus
        status={status()}
        pending={pending.count() > 0}
        onUndo={undo}
        onRetry={() => pending.retry()}
      />
      <EntryPopover
        target={editor()?.target ?? null}
        anchor={anchor()}
        position="beside"
        zone={zone()}
        weekStart={weekStart()}
        projects={props.projects}
        entries={props.recent}
        issueLinks={props.issueLinks}
        owner={{ organizationId: props.organizationId, userId: props.userId }}
        region={userRegion(props.settings)}
        returnFocus={() => returnTo?.()}
        onSave={save}
        onDelete={remove}
        onDuplicate={duplicate}
        onClose={() => {
          drag.closed()
          setEditor(null)
        }}
      />
      <Show when={menu()}>
        {(open) => {
          function at() {
            return { x: open().x, y: open().y }
          }
          const current = open()
          return 'entry' in current ? (
            <PointMenu
              at={at()}
              label={m.menu_entry()}
              items={entryItems(current.entry)}
              class="w-60"
              onClose={() => setMenu(null)}
              onClosed={() => {
                if (!editor() && menuFocus) focusEntry(menuFocus)
                menuFocus = null
              }}
            />
          ) : (
            <PointMenu
              at={at()}
              label={slotTitle(current.start)}
              title={slotTitle(current.start)}
              items={slotItems(current.start)}
              hint={slotHint()}
              class="w-72"
              onClose={() => setMenu(null)}
            />
          )
        }}
      </Show>
    </Card>
  )
}
