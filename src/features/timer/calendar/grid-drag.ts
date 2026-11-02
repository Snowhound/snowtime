// Changing time on the week grid with a mouse or pen: dragging on empty time adds, on an entry
// moves it, and on its top or bottom edge changes its start or end. Alt (Option on a Mac) held
// while moving an entry copies it instead, as in desktop calendars; pressing or releasing it
// mid-drag switches. On touch a tap adds or edits and dragging scrolls; a long press that
// lifts without moving opens the context menu, and one that then drags moves the entry, or
// adds time on empty time. Alt+arrow keys move a focused entry or change its end.
import { createSignal } from 'solid-js'
import { m } from '~/paraglide/messages.js'
import { changedFields } from '../entries'
import type { Entry } from '../queries'
import { HOUR_PX } from './calendar-block'
import {
  DAY_MINUTES,
  type Drag,
  type DragError,
  type DragRange,
  type Range,
  SNAP_MINUTES,
  type Slot,
  clickRange,
  dragRange,
  nudge,
} from './week-grid'

// A pointer that moves less than this is a click, not a drag.
const DRAG_PX = 4
// A press this soon after the popover closed on a click outside doesn't also add time.
const CLOSED_MS = 300
// A touch held this long without moving is a long press.
const LONG_PRESS_MS = 500

const KEYS: Record<string, { minutes: number } | { days: number }> = {
  ArrowUp: { minutes: -SNAP_MINUTES },
  ArrowDown: { minutes: SNAP_MINUTES },
  ArrowLeft: { days: -1 },
  ArrowRight: { days: 1 },
}

export const DROP_ERRORS: Record<DragError, { ghost: () => string; status: () => string }> = {
  running_future: { ghost: m.entry_error_running_future, status: m.calendar_error_running_future },
}

function toDate(ms: number | undefined) {
  return ms === undefined ? undefined : new Date(ms)
}

interface DragState {
  drag: Drag
  entryId?: string
  // What the press began on, for a long press's menu.
  target: HTMLElement
  x: number
  y: number
  touch: boolean
  // A touch held for LONG_PRESS_MS: the page no longer scrolls under it.
  pressed: boolean
  // The running entry, which a long press opens the menu of but doesn't move.
  still: boolean
  active: boolean
  // Alt is held on a move, which drops a copy.
  copy: boolean
  range?: DragRange
}

export function createGridDrag(options: {
  // The grid's body, whose [data-date] columns the pointer is over.
  body: () => HTMLElement | undefined
  zone: () => string
  // While the popover is open, a press only closes it.
  blocked: () => boolean
  findEntry: (id: string | undefined) => Entry | undefined
  // New time from a click or a drag on empty time.
  onSlot: (slot: Range) => void
  // `key` is true for a change an Alt+arrow key made.
  onChange: (
    entry: Entry,
    patch: { startedAt?: Date; stoppedAt?: Date },
    verb: 'moved' | 'changed',
    key: boolean,
  ) => void
  // An Alt+drag's copy of the entry, where it was dropped.
  onCopy: (entry: Entry, range: Range) => void
  // A long press lifted where it began, on an entry or on empty time.
  onMenu: (target: HTMLElement, x: number, y: number) => void
  onStatus: (status: { text: string; error?: boolean }) => void
}) {
  const [state, setState] = createSignal<DragState | null>(null)
  // The click that ends a drag isn't an edit.
  let suppressClick = false
  let closedAt = 0
  let pressTimer: ReturnType<typeof setTimeout> | undefined

  function end() {
    clearTimeout(pressTimer)
    setState(null)
  }

  function skipClick() {
    suppressClick = true
    setTimeout(() => (suppressClick = false))
  }

  function slotAt(x: number, y: number): Slot {
    const cols = [...options.body()!.querySelectorAll<HTMLElement>('[data-date]')]
    const col =
      cols.find((c) => {
        const r = c.getBoundingClientRect()
        return x >= r.left && x < r.right
      }) ?? (x < cols[0].getBoundingClientRect().left ? cols[0] : cols.at(-1)!)
    const minutes = ((y - col.getBoundingClientRect().top) / HOUR_PX) * 60
    return { date: col.dataset.date!, minutes: Math.max(0, Math.min(DAY_MINUTES, minutes)) }
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || options.blocked() || Date.now() - closedAt < CLOSED_MS) return
    const target = event.target as HTMLElement
    const block = target.closest<HTMLElement>('[data-entry]')
    const touch = event.pointerType === 'touch'
    let drag: Drag
    let entryId: string | undefined
    let still = false
    if (block) {
      const entry = options.findEntry(block.dataset.entry)
      const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle
      const kind = handle === 'start' || handle === 'end' ? handle : 'move'
      if (!entry) return
      // A running entry ends at now, so only its start moves; a long press still opens its menu.
      still = kind === 'move' && !entry.stoppedAt
      if (still && !touch) return
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
    setState({
      drag,
      entryId,
      target,
      x: event.clientX,
      y: event.clientY,
      touch,
      pressed: false,
      still,
      active: false,
      copy: false,
    })
    clearTimeout(pressTimer)
    if (touch) {
      pressTimer = setTimeout(() => setState((s) => s && { ...s, pressed: true }), LONG_PRESS_MS)
    }
    // No text selection while dragging. The pointer is captured once the drag starts, so a
    // plain click still reaches the entry.
    if (!touch) event.preventDefault()
  }

  function pointerMove(event: PointerEvent) {
    const current = state()
    if (!current) return
    const moved = Math.hypot(event.clientX - current.x, event.clientY - current.y) >= DRAG_PX
    // A touch that moves before the long press is a scroll.
    if (current.touch && !current.pressed) {
      if (moved) end()
      return
    }
    if (current.still || (!current.active && !moved)) return
    if (!current.active) options.body()?.setPointerCapture?.(event.pointerId)
    const to = slotAt(event.clientX, event.clientY)
    const range = dragRange(current.drag, to, options.zone(), Date.now())
    setState({
      ...current,
      active: true,
      copy: current.drag.kind === 'move' && event.altKey,
      range,
    })
  }

  function pointerUp() {
    const current = state()
    end()
    if (!current) return
    if (current.pressed && !current.active) {
      skipClick()
      options.onMenu(current.target, current.x, current.y)
      return
    }
    if (!current.active) {
      // A click on an entry opens it through the button's click.
      if (current.drag.kind !== 'create') return
      options.onSlot(clickRange(current.drag.from, options.zone()))
      return
    }
    skipClick()
    const { range, drag } = current
    if (!range) return
    if (range.error) {
      options.onStatus({ text: DROP_ERRORS[range.error].status(), error: true })
      return
    }
    if (drag.kind === 'create') {
      options.onSlot(range)
      return
    }
    const entry = options.findEntry(current.entryId)
    if (!entry) return
    if (current.copy) {
      options.onCopy(entry, range)
      return
    }
    const next = { startedAt: new Date(range.startedAt), stoppedAt: new Date(range.stoppedAt) }
    const patch = changedFields(
      entry,
      next,
      entry.stoppedAt ? ['startedAt', 'stoppedAt'] : ['startedAt'],
    )
    if (patch) options.onChange(entry, patch, drag.kind === 'move' ? 'moved' : 'changed', false)
  }

  // A long press keeps the page from scrolling, so the drag after it moves the entry. A
  // non-passive touchmove listener calls it: scrolling doesn't wait for pointer events.
  function touchMove(event: TouchEvent) {
    if (state()?.pressed) event.preventDefault()
  }

  // Alt+Up and Alt+Down move a focused entry by 15 minutes and Alt+Left and Alt+Right by a
  // day; with Shift, Alt+Up and Alt+Down change its end. Alt+Left is the browser's Back on
  // Windows and Linux, so the grid keeps it on an entry.
  function keyDown(event: KeyboardEvent) {
    const block = (event.target as HTMLElement).closest<HTMLElement>('[data-entry]')
    const key = KEYS[event.key]
    if (!block || !event.altKey || !key) return
    event.preventDefault()
    const entry = options.findEntry(block.dataset.entry)
    if (!entry) return
    const times = {
      startedAt: entry.startedAt.getTime(),
      stoppedAt: entry.stoppedAt?.getTime() ?? null,
    }
    const result = nudge(times, { ...key, end: event.shiftKey }, options.zone(), Date.now())
    if (!result) return
    const next = { startedAt: toDate(result.startedAt), stoppedAt: toDate(result.stoppedAt) }
    const patch = changedFields(entry, next, ['startedAt', 'stoppedAt'])
    if (patch) options.onChange(entry, patch, event.shiftKey ? 'changed' : 'moved', true)
  }

  return {
    state,
    slotAt,
    pointerDown,
    pointerMove,
    pointerUp,
    cancel: end,
    touchMove,
    keyDown,
    suppressesClick: () => suppressClick,
    // The popover closed on a click outside, which shouldn't also add time.
    closed() {
      closedAt = Date.now()
    },
  }
}
