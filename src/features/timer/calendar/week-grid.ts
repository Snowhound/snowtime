// The week calendar's time math (prototypes/calendar.html): each entry's pieces on the days
// it touches, side by side where they overlap, and the times a click, a drag, or an Alt+arrow
// key gives, in the user's zone. Positions are wall-clock minutes from the day's midnight, so
// the hour lines stay right on the days clocks change.
import {
  type IsoDate,
  addDays,
  atLocalTime,
  countedSpan,
  dayRange,
  daysBetween,
  localDate,
  offsetAt,
  runningMs,
  sameTimeOn,
  weekday,
} from '~/lib/calendar'
import { lastEnded } from '../entries'

const MINUTE = 60_000
export const DAY_MINUTES = 24 * 60
// The grid snaps to this, and Alt+Up and Alt+Down move by it.
export const SNAP_MINUTES = 15
// A click on empty time adds this much: the half-hour cell clicked.
const CLICK_MINUTES = 30
// A click this close above a half-hour line counts as below it: 4 px at 48 px an hour.
const CLICK_SLACK_MINUTES = 5
// The week opens at this minute, or earlier when its first entry starts before.
const MORNING_MINUTES = 7 * 60
const SNAP_MS = SNAP_MINUTES * MINUTE

export interface Span {
  startedAt: Date
  stoppedAt: Date | null
}

export function weekDates(first: IsoDate): IsoDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

export function isWeekend(date: IsoDate) {
  return [0, 6].includes(weekday(date))
}

// Wall-clock minutes from the start of the date to the instant, counting on past midnight.
export function minutesInto(ms: number, date: IsoDate, zone: string) {
  return (ms + offsetAt(ms, zone) - Date.parse(`${date}T00:00:00Z`)) / MINUTE
}

// The instant the zone's clocks read whole `minutes` past the date's midnight; minutes past
// 24:00 or before 00:00 fall on the next or previous days.
export function instantAt(date: IsoDate, minutes: number, zone: string) {
  const days = Math.floor(minutes / DAY_MINUTES)
  const rest = minutes - days * DAY_MINUTES
  const time = `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`
  return atLocalTime(addDays(date, days), time, zone)
}

export function snap(minutes: number) {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES
}

function floorTo(ms: number, step: number) {
  return Math.floor(ms / step) * step
}

// The same wall-clock time `days` later, keeping the seconds.
function shiftDays(ms: number, days: number, zone: string) {
  return sameTimeOn(ms, addDays(localDate(ms, zone), days), zone)
}

// An entry's time on one day: [from, to) as instants and [top, bottom) as the day's minutes.
// `first` and `last` hold the entry's start and end, where its edges resize it.
export interface Piece<T> {
  key: string
  entry: T
  date: IsoDate
  from: number
  to: number
  top: number
  bottom: number
  first: boolean
  last: boolean
}

// The pieces of the entries on the date, each clipped at the day's midnights. A running entry
// runs to now.
export function piecesOn<T extends Span & { id: string }>(
  entries: readonly T[],
  date: IsoDate,
  zone: string,
  now: number,
): Piece<T>[] {
  const day = dayRange(date, zone)
  const pieces: Piece<T>[] = []
  for (const entry of entries) {
    const span = countedSpan(entry, day, now)
    if (!span) continue
    const end =
      entry.stoppedAt?.getTime() ?? entry.startedAt.getTime() + runningMs(entry.startedAt, now)
    const top = minutesInto(span.from, date, zone)
    // The hour clocks repeat when they fall back can put the end above the start.
    const bottom =
      span.to === day.to ? DAY_MINUTES : Math.max(top, minutesInto(span.to, date, zone))
    pieces.push({
      key: `${entry.id}|${date}`,
      entry,
      date,
      from: span.from,
      to: span.to,
      top,
      bottom,
      first: span.from === entry.startedAt.getTime(),
      last: span.to === end,
    })
  }
  return pieces
}

export type Placed<T> = Piece<T> & { column: number; columns: number }

// Side by side where pieces overlap: each cluster of overlapping pieces splits the width into
// as many columns as it needs at once, and each piece takes the first column free at its start.
export function sideBySide<T>(pieces: readonly Piece<T>[]): Placed<T>[] {
  const sorted = [...pieces].sort((a, b) => a.from - b.from || b.to - a.to)
  const placed: Placed<T>[] = []
  let cluster: Piece<T>[] = []
  let clusterEnd = -Infinity
  function flush() {
    const ends: number[] = []
    const columns = cluster.map((piece) => {
      let column = ends.findIndex((end) => end <= piece.from)
      if (column < 0) column = ends.push(0) - 1
      ends[column] = piece.to
      return column
    })
    cluster.forEach((piece, i) =>
      placed.push({ ...piece, column: columns[i], columns: ends.length }),
    )
    cluster = []
  }
  for (const piece of sorted) {
    if (piece.from >= clusterEnd) flush()
    cluster.push(piece)
    clusterEnd = Math.max(clusterEnd, piece.to)
  }
  flush()
  return placed
}

// The minute the week opens at: 07:00, or half an hour before its first piece when earlier.
export function openingMinute(pieces: readonly { top: number }[]) {
  return Math.max(0, Math.min(MORNING_MINUTES, ...pieces.map((p) => p.top - 30)))
}

// A point on the grid: a day and the minutes into it.
export interface Slot {
  date: IsoDate
  minutes: number
}

export interface Range {
  startedAt: number
  stoppedAt: number
}

// The half-hour cell clicked, up to now; null when it would start in the future. A click
// just above a cell's top line, within CLICK_SLACK_MINUTES, takes the cell below.
export function clickRange(slot: Slot, zone: string, now: number): Range | null {
  const minutes = floorTo(slot.minutes + CLICK_SLACK_MINUTES, CLICK_MINUTES)
  const startedAt = instantAt(slot.date, Math.min(minutes, DAY_MINUTES - CLICK_MINUTES), zone)
  const stoppedAt = Math.min(startedAt + CLICK_MINUTES * MINUTE, floorTo(now, MINUTE))
  return stoppedAt > startedAt ? { startedAt, stoppedAt } : null
}

// Add entry's slot: half an hour from the end of today's last entry, or from an hour ago,
// up to now.
export function addRange(entries: readonly Span[], zone: string, now: number): Range {
  const last = lastEnded(entries, { before: now, day: { date: localDate(now, zone), zone } })
  const stoppedAt = floorTo(now, MINUTE)
  let startedAt = last?.stoppedAt.getTime() ?? floorTo(now - 60 * MINUTE, SNAP_MS)
  if (stoppedAt - startedAt < MINUTE) startedAt = stoppedAt - CLICK_MINUTES * MINUTE
  return { startedAt, stoppedAt: Math.min(startedAt + CLICK_MINUTES * MINUTE, stoppedAt) }
}

// What a drag started: new time from a slot, or an entry moved or resized by an edge.
export type Drag =
  | { kind: 'create'; from: Slot }
  | { kind: 'move' | 'start' | 'end'; from: Slot; startedAt: number; stoppedAt: number | null }

// Why a drop changes nothing: an entry can't end in the future, nor new time start there.
export type DragError = 'future' | 'add_future'

export type DragRange = Range & { error?: DragError }

// The times a drag from `drag.from` to `to` gives, snapped to 15 minutes. New time stays on
// the day the drag started. A move keeps the duration and shifts by whole days between
// columns. An edge changes the start or the end and keeps at least 15 minutes; the end stops
// at now, and a running entry's start at 15 minutes before now.
export function dragRange(drag: Drag, to: Slot, zone: string, now: number): DragRange {
  if (drag.kind === 'create') {
    const a = instantAt(drag.from.date, snap(drag.from.minutes), zone)
    const b = instantAt(drag.from.date, snap(to.minutes), zone)
    const startedAt = Math.min(a, b)
    const stoppedAt = Math.min(Math.max(a, b, startedAt + SNAP_MS), floorTo(now, SNAP_MS))
    return stoppedAt > startedAt
      ? { startedAt, stoppedAt }
      : { startedAt, stoppedAt: startedAt, error: 'add_future' }
  }
  const delta = to.minutes - drag.from.minutes
  const end = drag.stoppedAt ?? now
  if (drag.kind === 'move') {
    const days = daysBetween(drag.from.date, to.date)
    const startedAt = shiftDays(drag.startedAt, days, zone) + snap(delta) * MINUTE
    const stoppedAt = startedAt + end - drag.startedAt
    return stoppedAt > now ? { startedAt, stoppedAt, error: 'future' } : { startedAt, stoppedAt }
  }
  if (drag.kind === 'start') {
    const date = localDate(drag.startedAt, zone)
    const minutes = snap(minutesInto(drag.startedAt, date, zone) + delta)
    return { startedAt: Math.min(instantAt(date, minutes, zone), end - SNAP_MS), stoppedAt: end }
  }
  // The day the end is on; an end at midnight belongs to the day before.
  const date = localDate(end - 1, zone)
  const minutes = snap(minutesInto(end, date, zone) + delta)
  const stoppedAt = Math.max(instantAt(date, minutes, zone), drag.startedAt + SNAP_MS)
  return { startedAt: drag.startedAt, stoppedAt: Math.min(stoppedAt, floorTo(now, MINUTE)) }
}

// An Alt+arrow key: 15 minutes up or down, or a day left or right; with Shift, the end only.
export type Nudge = { minutes: number; end: boolean } | { days: number; end: boolean }

export type NudgeResult =
  | { startedAt?: number; stoppedAt?: number; error?: undefined }
  | { error: 'future' }

// The entry's new times for the key, or null when the key doesn't apply: a running entry
// ends at now, so only its start moves, by minutes and up to a minute before now.
export function nudge(
  entry: { startedAt: number; stoppedAt: number | null },
  key: Nudge,
  zone: string,
  now: number,
): NudgeResult | null {
  const minutes = 'minutes' in key ? key.minutes * MINUTE : null
  let result: { startedAt?: number; stoppedAt?: number }
  if (key.end) {
    if (minutes === null || entry.stoppedAt === null) return null
    result = { stoppedAt: Math.max(entry.stoppedAt + minutes, entry.startedAt + SNAP_MS) }
  } else if (entry.stoppedAt === null) {
    if (minutes === null) return null
    result = { startedAt: Math.min(entry.startedAt + minutes, now - MINUTE) }
  } else {
    const shift =
      minutes ?? shiftDays(entry.startedAt, (key as { days: number }).days, zone) - entry.startedAt
    result = { startedAt: entry.startedAt + shift, stoppedAt: entry.stoppedAt + shift }
  }
  if ((result.stoppedAt ?? 0) > now) return { error: 'future' }
  return result
}
