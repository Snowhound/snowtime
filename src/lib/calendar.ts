// Calendar math in a user's IANA time zone, for reports (docs/architecture.md, "Time
// zones"). Calendar days are ISO dates such as '2026-03-29'; instants are epoch
// milliseconds. Pure: Intl supplies the zone offsets, so tests need no database.

import { MAX_ENTRY_MS } from '~/server/entries/entries.schemas'

export type IsoDate = string
export type WeekStart = 'mon' | 'sun'

const DAY = 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(zone: string) {
  let f = formatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(zone, f)
  }
  return f
}

// The zone's wall-clock time at the instant, as epoch milliseconds of the same reading in
// UTC. Whole seconds: zone offsets never have a fraction of one.
function wallClock(ms: number, zone: string): number {
  const seconds = Math.floor(ms / 1000) * 1000
  const p: Record<string, number> = {}
  for (const part of formatter(zone).formatToParts(seconds)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) + (ms - seconds)
}

// Milliseconds the zone is ahead of UTC at the instant, e.g. 3 * 3_600_000 for Tallinn
// in summer.
export function offsetAt(ms: number, zone: string): number {
  return wallClock(ms, zone) - ms
}

function dayNumber(date: IsoDate): number {
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(ms) || toIsoDate(ms) !== date) {
    throw new RangeError(`Not an ISO date: ${date}`)
  }
  return ms
}

function toIsoDate(utcMs: number): IsoDate {
  return new Date(utcMs).toISOString().slice(0, 10)
}

// The calendar day of the instant in the zone.
export function localDate(ms: number, zone: string): IsoDate {
  return toIsoDate(wallClock(ms, zone))
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIsoDate(dayNumber(date) + days * DAY)
}

// Whole days from one date to another; negative when `to` is earlier.
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((dayNumber(to) - dayNumber(from)) / DAY)
}

// 0 for Sunday through 6 for Saturday, as Date.getUTCDay().
export function weekday(date: IsoDate): number {
  return new Date(dayNumber(date)).getUTCDay()
}

// The first day of the week holding the date.
export function startOfWeek(date: IsoDate, weekStart: WeekStart): IsoDate {
  const first = weekStart === 'mon' ? 1 : 0
  return addDays(date, -((weekday(date) - first + 7) % 7))
}

// The first day of the date's month and of the next one, the bounds of a report on it.
export function monthDates(date: IsoDate): { from: IsoDate; to: IsoDate } {
  const d = new Date(dayNumber(date))
  return {
    from: toIsoDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
    to: toIsoDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)),
  }
}

// The first instant of the day in the zone. That is local midnight, or its first
// occurrence when clocks fell back at midnight, or the moment clocks sprang forward when
// the zone skipped midnight (as Chile and formerly Brazil do).
export function startOfDay(date: IsoDate, zone: string): number {
  const midnight = dayNumber(date)
  // A transition near midnight is within a day either side, so these are all the offsets
  // that can apply.
  const offsets = [...new Set([-DAY, 0, DAY].map((d) => offsetAt(midnight + d, zone)))]
  const exact = offsets.map((o) => midnight - o).filter((t) => wallClock(t, zone) === midnight)
  if (exact.length > 0) return Math.min(...exact)

  // Midnight fell in a gap: find the first instant whose wall clock is past it.
  let lo = midnight - Math.max(...offsets)
  let hi = midnight - Math.min(...offsets)
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000
    if (wallClock(mid, zone) >= midnight) hi = mid
    else lo = mid
  }
  return hi
}

export interface Range {
  from: number
  to: number
}

// The day as a half-open UTC range. 23 or 25 hours long on the days clocks change.
export function dayRange(date: IsoDate, zone: string): Range {
  return { from: startOfDay(date, zone), to: startOfDay(addDays(date, 1), zone) }
}

// The week holding the date as a half-open UTC range.
export function weekRange(date: IsoDate, zone: string, weekStart: WeekStart): Range {
  const first = startOfWeek(date, weekStart)
  return { from: startOfDay(first, zone), to: startOfDay(addDays(first, 7), zone) }
}

// The dates from `from` up to but not including `to`.
export function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = []
  for (let d = from; d < to; d = addDays(d, 1)) dates.push(d)
  return dates
}

export interface DayPiece {
  date: IsoDate
  ms: number
}

// Splits [start, end) at the zone's midnights into the time on each calendar day. Empty
// when end is not after start.
export function splitByDay(start: number, end: number, zone: string): DayPiece[] {
  const pieces: DayPiece[] = []
  let date = localDate(start, zone)
  while (start < end) {
    const next = Math.min(startOfDay(addDays(date, 1), zone), end)
    if (next > start) pieces.push({ date, ms: next - start })
    start = Math.max(start, next)
    date = addDays(date, 1)
  }
  return pieces
}

// How long a running entry has run at `now`, up to the longest an entry runs, where stopping
// it would end it.
export function runningMs(startedAt: Date, now: number) {
  return Math.min(now, startedAt.getTime() + MAX_ENTRY_MS) - startedAt.getTime()
}

// The span an entry counts for: a running entry (no stoppedAt) runs up to now, or up to the
// longest an entry runs, where stopping it would end it, and an entry is clipped to the
// range. Null when nothing of it falls inside.
export function countedSpan(
  entry: { startedAt: Date; stoppedAt: Date | null },
  range: Range,
  now: number,
): Range | null {
  const from = Math.max(entry.startedAt.getTime(), range.from)
  const end =
    entry.stoppedAt?.getTime() ?? entry.startedAt.getTime() + runningMs(entry.startedAt, now)
  const to = Math.min(end, range.to)
  return to > from ? { from, to } : null
}

// The instant the zone's clocks read `time` ('HH:MM') on the date. A time skipped when
// clocks spring forward counts as the same distance past the jump (02:30 becomes 03:30);
// a repeated time when they fall back is its first occurrence.
export function atLocalTime(date: IsoDate, time: string, zone: string): number {
  const [h, min] = time.split(':').map(Number)
  const wall = dayNumber(date) + (h * 60 + min) * 60_000
  const offsets = [...new Set([-DAY, 0, DAY].map((d) => offsetAt(wall + d, zone)))]
  const exact = offsets.map((o) => wall - o).filter((t) => wallClock(t, zone) === wall)
  if (exact.length > 0) return Math.min(...exact)
  return wall - offsetAt(wall - DAY, zone)
}

// The zone's wall-clock time at the instant, as 'HH:MM'.
export function localTime(ms: number, zone: string): string {
  return new Date(wallClock(ms, zone)).toISOString().slice(11, 16)
}
