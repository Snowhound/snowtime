// Rules for the catalogue's sets. A date rule takes a date in the user's zone and says whether
// the set is for it; a fill rule does the same for the fill summary.
import { type IsoDate, addDays, weekday } from '~/lib/calendar'
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
