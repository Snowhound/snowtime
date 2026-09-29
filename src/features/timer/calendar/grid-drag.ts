// Changing time on the week grid with a mouse or pen: dragging on empty time adds, on an entry
// moves it, and on its top or bottom edge changes its start or end. On touch a tap adds or edits
// and dragging scrolls. Alt+arrow keys move a focused entry or change its end.
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

const KEYS: Record<string, { minutes: number } | { days: number }> = {
  ArrowUp: { minutes: -SNAP_MINUTES },
  ArrowDown: { minutes: SNAP_MINUTES },
  ArrowLeft: { days: -1 },
  ArrowRight: { days: 1 },
}

export const DROP_ERRORS: Record<DragError, { ghost: () => string; status: () => string }> = {
  future: { ghost: m.entry_error_future, status: m.calendar_error_future },
  add_future: { ghost: m.calendar_add_up_to_now, status: m.calendar_error_add_future },
}

function toDate(ms: number | undefined) {
  return ms === undefined ? undefined : new Date(ms)
}

interface DragState {
  drag: Drag
  entryId?: string
  x: number
  y: number
  touch: boolean
  active: boolean
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
  onStatus: (status: { text: string; error?: boolean }) => void
}) {
  const [state, setState] = createSignal<DragState | null>(null)
  // The click that ends a drag isn't an edit.
  let suppressClick = false
  let closedAt = 0

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
    if (block) {
      const entry = options.findEntry(block.dataset.entry)
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
    setState({ drag, entryId, x: event.clientX, y: event.clientY, touch, active: false })
    // No text selection while dragging. The pointer is captured once the drag starts, so a
    // plain click still reaches the entry.
    if (!touch) event.preventDefault()
  }

  function pointerMove(event: PointerEvent) {
    const current = state()
    if (!current || current.touch) return
    if (
      !current.active &&
      Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_PX
    ) {
      return
    }
    if (!current.active) options.body()?.setPointerCapture?.(event.pointerId)
    const to = slotAt(event.clientX, event.clientY)
    const range = dragRange(current.drag, to, options.zone(), Date.now())
    setState({ ...current, active: true, range })
  }

  function pointerUp() {
    const current = state()
    setState(null)
    if (!current) return
    if (!current.active) {
      // A click on an entry opens it through the button's click.
      if (current.drag.kind !== 'create') return
      const slot = clickRange(current.drag.from, options.zone(), Date.now())
      if (slot) options.onSlot(slot)
      else options.onStatus({ text: m.calendar_add_up_to_now() })
      return
    }
    suppressClick = true
    setTimeout(() => (suppressClick = false))
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
    const next = { startedAt: new Date(range.startedAt), stoppedAt: new Date(range.stoppedAt) }
    const patch = changedFields(
      entry,
      next,
      entry.stoppedAt ? ['startedAt', 'stoppedAt'] : ['startedAt'],
    )
    if (patch) options.onChange(entry, patch, drag.kind === 'move' ? 'moved' : 'changed', false)
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
    if (result.error) {
      options.onStatus({ text: DROP_ERRORS.future.status(), error: true })
      return
    }
    const next = { startedAt: toDate(result.startedAt), stoppedAt: toDate(result.stoppedAt) }
    const patch = changedFields(entry, next, ['startedAt', 'stoppedAt'])
    if (patch) options.onChange(entry, patch, event.shiftKey ? 'changed' : 'moved', true)
  }

  return {
    state,
    pointerDown,
    pointerMove,
    pointerUp,
    cancel: () => setState(null),
    keyDown,
    suppressesClick: () => suppressClick,
    // The popover closed on a click outside, which shouldn't also add time.
    closed() {
      closedAt = Date.now()
    },
  }
}
