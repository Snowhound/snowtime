// The page tagline's pick (docs/architecture/taglines.md), first match wins: a timer left
// running, a date's set, a period's on its last days (the month's last three, else Friday),
// gaps in the timesheet, praise, the days before filled but not today, else the season's sets
// and the day's ranges in turn. Without a zone, as on the sign-in page, only the season's sets
// show.
import { type IsoDate, addDays, localDate, monthDates, runningMs, weekday } from '~/lib/calendar'
import type { Season } from '~/lib/scene/scene'
import { inTurn, seasonSets } from '~/lib/scene/seasons'
import { type Locale, getLocale } from '~/paraglide/runtime.js'
import { type Behaviour, type Period, TAGLINES, type TaglineSet } from './catalogue'
import type { FillFacts, FillSummary } from './fill'

// The month's last days that count as its end.
const MONTH_END_DAYS = 3
// A timer running this long, or past midnight, gets the timer sets.
const TIMER_LONG_MS = 8 * 3_600_000
// Empty working days in a row that count as an absence rather than a gap.
const AWAY_DAYS = 3

type When = { now?: number; timeZone?: string; locale?: Locale; fill?: FillSummary | null }

// Where the picked set came from.
export type TaglineSource = 'season' | 'date' | 'period' | Behaviour

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

function behaving(name: Behaviour, fill: FillFacts, locale: Locale) {
  return linesFor(
    (s) => 'behaviour' in s.when && s.when.behaviour === name && (s.when.if?.(fill) ?? true),
    locale,
  )
}

// The timesheet period whose last days the date is in, whatever the week start.
function periodEnding(date: IsoDate): Period | undefined {
  if (date >= addDays(monthDates(date).to, -MONTH_END_DAYS)) return 'monthEnd'
  if (weekday(date) === 5) return 'weekEnd'
  return undefined
}

// The summary at `now`. One from another day, such as a page left open overnight, still
// has the running timer, but its days are out of date, so none of them counts.
function factsAt(fill: FillSummary, today: IsoDate, now: number, timeZone: string): FillFacts {
  const started = fill.timerStartedAt
  const timer = {
    timerMs: started === null ? null : runningMs(new Date(started), now),
    timerOvernight: started !== null && localDate(started, timeZone) < today,
  }
  if (fill.date === today) return { ...fill, ...timer }
  return {
    date: today,
    timerStartedAt: started,
    today: 'off',
    lastWorkingDay: null,
    lastWeek: null,
    lastMonth: null,
    caughtUp: false,
    emptyDays: 0,
    streak: 0,
    ...timer,
  }
}

// The behaviour the summary shows before the dated sets: a timer left running.
function timerBehaviour(fill: FillFacts): Behaviour | undefined {
  if (fill.timerOvernight || (fill.timerMs ?? 0) >= TIMER_LONG_MS) return 'timer'
  return undefined
}

// The behaviours the summary shows after the dated and period sets, in the order they count.
function dayBehaviours(fill: FillFacts): Behaviour[] {
  const found: Behaviour[] = []
  if (fill.emptyDays >= AWAY_DAYS) found.push('away')
  else if (fill.emptyDays > 0) found.push('gap')
  if (fill.today === 'filled' && fill.caughtUp) found.push('praise')
  if (fill.today === 'open' && (fill.lastWorkingDay?.filled || fill.lastWeek || fill.lastMonth)) {
    found.push('andToday')
  }
  return found
}

// Fills a set's placeholders, the same in every language.
function fillIn(lines: string[], fill: FillFacts | undefined) {
  const values: Record<string, number> = {
    hours: Math.floor((fill?.timerMs ?? 0) / 3_600_000),
    days: fill?.streak ?? 0,
  }
  return lines.map((line) =>
    line.replaceAll(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match)),
  )
}

// The tagline shows the first two lines; a set's third line can rise in under them.
export function taglinePick(
  season: Season,
  when: When = {},
): { lines: string[]; source: TaglineSource } {
  const { now = Date.now(), timeZone, locale = getLocale(), fill: summary } = when
  if (!timeZone) return { lines: inTurn(seasonSets(season, locale), now), source: 'season' }
  const today = localDate(now, timeZone)
  const fill = summary ? factsAt(summary, today, now, timeZone) : undefined

  function first(source: TaglineSource, sets: string[][]) {
    return sets.length > 0 ? { lines: fillIn(inTurn(sets, now), fill), source } : undefined
  }
  const timer = fill && timerBehaviour(fill)
  const ending = periodEnding(today)
  const periodLines = ending && period(ending, locale)
  const picked =
    (fill && timer && first(timer, behaving(timer, fill, locale))) ??
    first('date', onDate(today, locale)) ??
    first('period', periodLines ? [periodLines] : [])
  if (picked) return picked
  if (fill) {
    for (const behaviour of dayBehaviours(fill)) {
      const found = first(behaviour, behaving(behaviour, fill, locale))
      if (found) return found
    }
  }
  return {
    lines: inTurn([...seasonSets(season, locale), ...inRange(today, locale)], now),
    source: 'season',
  }
}

export function taglineLines(season: Season, when: When = {}): string[] {
  return taglinePick(season, when).lines
}
