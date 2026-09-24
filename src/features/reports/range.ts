// A report's range: presets, previous and next, and the URL form of each. Days are the
// user's calendar days (src/lib/calendar.ts), so these only need today's date in their zone.
import {
  type IsoDate,
  type WeekStart,
  addDays,
  daysBetween,
  monthDates,
  startOfWeek,
} from '~/lib/calendar'
import { MAX_REPORT_DAYS } from '~/server/reports/reports.schemas'

export const PRESETS = ['today', 'this-week', 'last-week', 'this-month', 'last-month'] as const
export type Preset = (typeof PRESETS)[number]
export type RangePreset = Preset | 'custom'

// `to` is exclusive, as getReport takes it; the URL and the To field show the last day.
export interface Range {
  from: IsoDate
  to: IsoDate
}

// Ranges longer than this total per week, so a grid stays readable.
export const MAX_DAY_COLUMNS = 35

export function presetRange(preset: Preset, today: IsoDate, weekStart: WeekStart): Range {
  const week = startOfWeek(today, weekStart)
  const month = monthDates(today)
  const ranges: Record<Preset, Range> = {
    today: { from: today, to: addDays(today, 1) },
    'this-week': { from: week, to: addDays(week, 7) },
    'last-week': { from: addDays(week, -7), to: week },
    'this-month': month,
    'last-month': monthDates(addDays(month.from, -1)),
  }
  return ranges[preset]
}

// The preset that covers exactly the range, so a shifted or typed range that lands on one
// shows it again.
export function matchPreset(range: Range, today: IsoDate, weekStart: WeekStart): RangePreset {
  return (
    PRESETS.find((p) => {
      const r = presetRange(p, today, weekStart)
      return r.from === range.from && r.to === range.to
    }) ?? 'custom'
  )
}

export function rangeDays(range: Range): number {
  return daysBetween(range.from, range.to)
}

function isMonth(range: Range) {
  const month = monthDates(range.from)
  return month.from === range.from && month.to === range.to
}

// The range before or after this one: the previous or next month for a calendar month,
// else as many days earlier or later.
export function shiftRange(range: Range, direction: -1 | 1): Range {
  if (isMonth(range)) {
    return direction < 0 ? monthDates(addDays(range.from, -1)) : monthDates(range.to)
  }
  const days = rangeDays(range) * direction
  return { from: addDays(range.from, days), to: addDays(range.to, days) }
}

// The range from two picked days, in either order, both included. Null when it is longer
// than a report may be.
export function pickedRange(a: IsoDate, b: IsoDate): Range | null {
  const [first, last] = a <= b ? [a, b] : [b, a]
  const range = { from: first, to: addDays(last, 1) }
  return rangeDays(range) > MAX_REPORT_DAYS ? null : range
}

// The range the URL asks for: a preset, or a custom range whose days are valid and in
// order. Anything else is this week.
export function resolveRange(
  search: { range?: RangePreset; from?: IsoDate; to?: IsoDate },
  today: IsoDate,
  weekStart: WeekStart,
): { preset: RangePreset; range: Range } {
  if (search.range === 'custom') {
    if (search.from && search.to && search.from <= search.to) {
      const range = pickedRange(search.from, search.to)
      if (range) return { preset: 'custom', range }
    }
  } else if (search.range) {
    return { preset: search.range, range: presetRange(search.range, today, weekStart) }
  }
  return { preset: 'this-week', range: presetRange('this-week', today, weekStart) }
}

// The search params for a range: only the preset when it is one, and nothing for this
// week, the default.
export function rangeSearch(range: Range, today: IsoDate, weekStart: WeekStart) {
  const preset = matchPreset(range, today, weekStart)
  if (preset === 'this-week') return {}
  if (preset !== 'custom') return { range: preset }
  return { range: preset, from: range.from, to: addDays(range.to, -1) }
}
