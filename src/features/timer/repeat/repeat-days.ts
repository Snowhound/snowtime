// The Repeat field's day math: which days a pattern
// gives up to Until, the preview's month grid, and each copy's times. A copy keeps the entry's
// wall-clock start and its length, so it stays at 08:30 across a clock change.
import {
  type IsoDate,
  type WeekStart,
  addDays,
  daysBetween,
  monthDates,
  sameTimeOn,
  startOfWeek,
  weekday,
} from '~/lib/calendar'
import { formatIsoDate } from '~/lib/format'
import { type Region, isWorkingDay } from '~/lib/holidays/holidays'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'

export const PATTERNS = ['workday', 'day', 'week', 'month'] as const
export type Pattern = (typeof PATTERNS)[number]
// The field's value: a pattern, or no repeat.
export type Repeat = Pattern | 'none'

// The entry the copies repeat: its day, its start, and its length.
export interface CopyBase {
  date: IsoDate
  startedAt: number
  length: number
}

export interface CopyTimes {
  startedAt: number
  stoppedAt: number
}

export function copyTimes(base: CopyBase, date: IsoDate, zone: string): CopyTimes {
  const startedAt = sameTimeOn(base.startedAt, date, zone)
  return { startedAt, stoppedAt: startedAt + base.length }
}

function dayOfMonth(date: IsoDate) {
  return Number(date.slice(8, 10))
}

export function isWeekendDay(date: IsoDate) {
  return [0, 6].includes(weekday(date))
}

// A weekday the region doesn't work.
export function isHoliday(date: IsoDate, region: Region) {
  return !isWeekendDay(date) && !isWorkingDay(date, region)
}

function matches(pattern: Pattern, base: CopyBase, date: IsoDate, region: Region) {
  if (pattern === 'workday') return isWorkingDay(date, region)
  if (pattern === 'week') return weekday(date) === weekday(base.date)
  if (pattern === 'month') return dayOfMonth(date) === dayOfMonth(base.date)
  return true
}

// Until starts at the end of the entry's month, or later for the sparser patterns.
export function defaultUntil(pattern: Pattern, date: IsoDate): IsoDate {
  const months = { workday: 0, day: 0, week: 1, month: 5 }[pattern]
  let first = monthDates(date).from
  for (let i = 0; i <= months; i++) first = monthDates(first).to
  return addDays(first, -1)
}

// The days after the entry's, up to Until, that match the pattern and don't already have the
// entry; `had` counts the matching days left out because they have it.
export function patternDays(options: {
  pattern: Pattern
  base: CopyBase
  until: IsoDate
  region: Region
  has: (date: IsoDate) => boolean
}) {
  const { pattern, base, until, region, has } = options
  const added: IsoDate[] = []
  let had = 0
  for (let i = 1; i <= daysBetween(base.date, until); i++) {
    const date = addDays(base.date, i)
    if (!matches(pattern, base, date, region)) continue
    if (has(date)) had++
    else added.push(date)
  }
  return { added, had }
}

// The month's weeks as cells, null outside the month.
export function monthCells(month: IsoDate, weekStart: WeekStart): (IsoDate | null)[] {
  const { from, to } = monthDates(month)
  const first = startOfWeek(from, weekStart)
  const count = Math.ceil(daysBetween(first, to) / 7) * 7
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(first, i)
    return date >= from && date < to ? date : null
  })
}

export function addMonths(month: IsoDate, months: number): IsoDate {
  let first = monthDates(month).from
  for (let i = 0; i < Math.abs(months); i++) {
    first = months > 0 ? monthDates(first).to : monthDates(addDays(first, -1)).from
  }
  return first
}

// "7th" in English, "7." in Estonian.
function ordinal(day: number) {
  if (getLocale() === 'et') return `${day}.`
  const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th' } as const
  const rule = new Intl.PluralRules('en', { type: 'ordinal' }).select(day)
  return `${day}${suffix[rule as keyof typeof suffix]}`
}

export function weekdayName(date: IsoDate) {
  return formatIsoDate(date, { weekday: 'long' })
}

export function monthDayName(date: IsoDate) {
  return ordinal(dayOfMonth(date))
}

// A pattern's name for the entry's day: "Every Wednesday", "Every month on the 7th".
export function patternLabel(pattern: Pattern, date: IsoDate) {
  if (pattern === 'workday') return m.copy_repeat_workday()
  if (pattern === 'day') return m.copy_repeat_day()
  if (pattern === 'week') return m.copy_repeat_week({ weekday: weekdayName(date) })
  return m.copy_repeat_month({ day: monthDayName(date) })
}
