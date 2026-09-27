// Working days by region, for the taglines about gaps in the timesheet (docs/architecture.md,
// "Working days"). Saturday and Sunday are never working days, whatever the Week start
// setting. Estonia's days off and shortened days come from riigipühad.ee, saved in ee.json by
// `bun run holidays:update`; the US's follow rules; other regions have weekends only.
import { type IsoDate, weekday } from '~/lib/calendar'
import EE from './ee.json'
import { usDaysOff } from './us'

// An ISO 3166-1 alpha-2 country code, such as 'EE'.
export type Region = string

const EE_OFF = new Set(EE.filter((d) => d.kind === 'off').map((d) => d.date))
const EE_SHORT = new Set(EE.filter((d) => d.kind === 'short').map((d) => d.date))

function isDayOff(date: IsoDate, region: Region) {
  if (region === 'EE') return EE_OFF.has(date)
  if (region === 'US') return usDaysOff(Number(date.slice(0, 4))).has(date)
  return false
}

export function isWorkingDay(date: IsoDate, region: Region) {
  const day = weekday(date)
  return day !== 0 && day !== 6 && !isDayOff(date, region)
}

// A working day with shorter hours by law, such as the day before Christmas Eve in Estonia.
export function isShortDay(date: IsoDate, region: Region) {
  return region === 'EE' && EE_SHORT.has(date)
}
