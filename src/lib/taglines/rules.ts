// Date rules for the catalogue's sets: each takes a date in the user's zone and says whether
// the set is for it.
import { type IsoDate, addDays, weekday } from '~/lib/calendar'

export type DateRule = (date: IsoDate) => boolean

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
