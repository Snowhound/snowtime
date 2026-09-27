// The page tagline's pick (docs/architecture.md, "Tagline"): a date's set, else a period's on
// its last days (the month's last three, else Friday), else the season's sets and the day's
// ranges in turn. Without a zone, as on the sign-in page, only the season's sets show.
import { type IsoDate, addDays, localDate, monthDates, weekday } from '~/lib/calendar'
import type { Season } from '~/lib/scene/scene'
import { inTurn, seasonSets } from '~/lib/scene/seasons'
import { type Locale, getLocale } from '~/paraglide/runtime.js'
import { type Period, TAGLINES, type TaglineSet } from './catalogue'

// The month's last days that count as its end.
const MONTH_END_DAYS = 3

type When = { now?: number; timeZone?: string; locale?: Locale }

// The lines of the sets `when` picks, in the user's language.
function linesFor(pick: (set: TaglineSet) => boolean, locale: Locale) {
  return TAGLINES.flatMap((set) => {
    const lines = set.lines[locale]
    return lines && pick(set) ? [lines] : []
  })
}

function onDate(date: IsoDate, locale: Locale) {
  return linesFor((s) => 'date' in s.when && s.when.date(date), locale)
}

function inRange(date: IsoDate, locale: Locale) {
  return linesFor((s) => 'range' in s.when && s.when.range(date), locale)
}

function period(name: Period, locale: Locale) {
  return linesFor((s) => 'period' in s.when && s.when.period === name, locale)[0]
}

// The timesheet period whose last days the date is in, whatever the week start.
function periodEnding(date: IsoDate): Period | undefined {
  if (date >= addDays(monthDates(date).to, -MONTH_END_DAYS)) return 'monthEnd'
  if (weekday(date) === 5) return 'weekEnd'
  return undefined
}

// The tagline shows the first two lines; a set's third line can rise in under them.
export function taglineLines(season: Season, when: When = {}): string[] {
  const { now = Date.now(), timeZone, locale = getLocale() } = when
  if (!timeZone) return inTurn(seasonSets(season, locale), now)
  const today = localDate(now, timeZone)
  const dates = onDate(today, locale)
  if (dates.length > 0) return inTurn(dates, now)
  const ending = periodEnding(today)
  const periodLines = ending && period(ending, locale)
  if (periodLines) return periodLines
  return inTurn([...seasonSets(season, locale), ...inRange(today, locale)], now)
}
