// Rules for the catalogue's sets. A date rule takes a date in the user's zone and says whether
// the set is for it; a fill rule does the same for the fill summary.
import { type IsoDate, addDays, daysBetween, weekday } from '~/lib/calendar'
import { MAX_ENTRY_MS } from '~/server/entries/entries.schemas'
import type { FillFacts } from './fill'

export type DateRule = (date: IsoDate) => boolean
export type FillRule = (fill: FillFacts) => boolean

// From one month and day to another, inclusive, as 'MM-DD'.
export function days(from: string, to = from): DateRule {
  return (date) => date.slice(5) >= from && date.slice(5) <= to
}

// The Monday after the month's last Sunday, the night the EU's clocks change.
export function mondayAfterLastSunday(month: string): DateRule {
  return (date) => {
    const sunday = addDays(date, -1)
    return (
      weekday(date) === 1 &&
      sunday.slice(5, 7) === month &&
      addDays(sunday, 7).slice(5, 7) !== month
    )
  }
}

// Easter Sunday in the Gregorian calendar, by the anonymous algorithm (Meeus, "Astronomical
// Algorithms").
export function easter(year: number): IsoDate {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  const month = String(Math.floor(n / 31)).padStart(2, '0')
  const day = String((n % 31) + 1).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Days from the year's Easter Sunday, inclusive: fromEaster(-47) is Shrove Tuesday.
export function fromEaster(from: number, to = from): DateRule {
  return (date) => {
    const offset = daysBetween(easter(Number(date.slice(0, 4))), date)
    return offset >= from && offset <= to
  }
}

// The month's first day from Monday to Friday, except January's, which the New Year's set has.
// It stands in for the first working day, since a date rule doesn't know the user's holidays.
export const monthStart: DateRule = (date) => {
  const day = Number(date.slice(8))
  const weekdayNumber = weekday(date)
  return (
    date.slice(5, 7) !== '01' &&
    weekdayNumber >= 1 &&
    weekdayNumber <= 5 &&
    (day === 1 || (weekdayNumber === 1 && day <= 3))
  )
}

export const fridayThe13th: DateRule = (date) => date.slice(8) === '13' && weekday(date) === 5

// The year's `n`th day, counting 1 January as the first.
export function dayOfYear(n: number): DateRule {
  return (date) => daysBetween(`${date.slice(0, 4)}-01-01`, date) === n - 1
}

export const timerCapped: FillRule = (fill) => (fill.timerMs ?? 0) >= MAX_ENTRY_MS

export const timerOvernight: FillRule = (fill) => fill.timerOvernight && !timerCapped(fill)

export const timerLong: FillRule = (fill) => !fill.timerOvernight && !timerCapped(fill)

// The last working day was yesterday.
export const lastWasYesterday: FillRule = (fill) =>
  fill.lastWorkingDay?.date === addDays(fill.date, -1)

// Today is Monday, and the last working day was Friday.
export const lastWasFriday: FillRule = (fill) =>
  weekday(fill.date) === 1 && fill.lastWorkingDay?.date === addDays(fill.date, -3)

export const lastWasEarlier: FillRule = (fill) => !lastWasYesterday(fill) && !lastWasFriday(fill)

export function all(...rules: FillRule[]): FillRule {
  return (fill) => rules.every((rule) => rule(fill))
}

export const lastFilled: FillRule = (fill) => !!fill.lastWorkingDay?.filled

export const lastWeekFilled: FillRule = (fill) => fill.lastWeek === true

export const lastMonthFilled: FillRule = (fill) => fill.lastMonth === true

// Filled working days in a row, today's included.
export function streakOf(days: number): FillRule {
  return (fill) => fill.streak >= days
}
