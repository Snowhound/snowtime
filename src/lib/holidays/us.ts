// US days off by rule: the federal holidays most private employers give, without Columbus Day
// and Veterans Day, plus the Friday after Thanksgiving and Christmas Eve.
import { type IsoDate, addDays, nthWeekday, weekday } from '~/lib/calendar'

// A fixed date on a Saturday is observed on the Friday before, on a Sunday on the Monday after.
function observed(date: IsoDate) {
  if (weekday(date) === 6) return addDays(date, -1)
  if (weekday(date) === 0) return addDays(date, 1)
  return date
}

// The working day before, skipping the weekend.
function weekdayBefore(date: IsoDate) {
  let day = addDays(date, -1)
  while (weekday(day) === 0 || weekday(day) === 6) day = addDays(day, -1)
  return day
}

// The days off observed for the year's holidays. New Year's Day on a Saturday is observed on
// 31 December of the year before.
function daysOff(year: number): IsoDate[] {
  const thanksgiving = nthWeekday(year, 11, 4, 4)
  const christmas = observed(`${year}-12-25`)
  return [
    observed(`${year}-01-01`),
    nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, 1, 3), // Presidents' Day
    nthWeekday(year, 5, 1, -1), // Memorial Day
    observed(`${year}-06-19`), // Juneteenth
    observed(`${year}-07-04`),
    nthWeekday(year, 9, 1, 1), // Labor Day
    thanksgiving,
    addDays(thanksgiving, 1),
    // Christmas Eve is the working day before Christmas's day off, so that when Christmas moves
    // onto 24 December, or 24 December onto Christmas, the two stay separate days.
    weekdayBefore(christmas),
    christmas,
  ]
}

const cache = new Map<number, Set<IsoDate>>()

// The days off that fall in the year, including the next year's New Year's Day moved back.
export function usDaysOff(year: number): Set<IsoDate> {
  let days = cache.get(year)
  if (!days) {
    const prefix = `${year}-`
    days = new Set([...daysOff(year), ...daysOff(year + 1)].filter((d) => d.startsWith(prefix)))
    cache.set(year, days)
  }
  return days
}
