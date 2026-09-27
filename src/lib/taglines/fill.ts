// The fill summary the timesheet taglines pick from (docs/architecture.md, "Tagline"): how the
// user's recent working days are filled, in their zone and region, across all their
// organizations. The server computes it with the session, so the server and the browser pick
// the same set.
import {
  type IsoDate,
  type Range,
  type WeekStart,
  addDays,
  countedSpan,
  datesBetween,
  localDate,
  monthDates,
  splitByDay,
  startOfDay,
  startOfWeek,
} from '~/lib/calendar'
import { type Region, isShortDay, isWorkingDay } from '~/lib/holidays/holidays'

// A working day counts as filled at this much logged time. Lax on purpose: the taglines are
// jokes and mustn't nag over a short day.
export const FILLED_MS = 6 * 3_600_000
// A shortened working day, such as the day before Christmas Eve in Estonia, is 3 hours shorter
// by law, so it's filled at 3 hours less.
const SHORT_DAY_MS = 3 * 3_600_000

export type FillSummary = {
  // The user's date the summary is for; the pick ignores a summary from another day.
  date: IsoDate
  // When the running timer started, in any organization.
  timerStartedAt: number | null
  // 'off' when today isn't a working day.
  today: 'filled' | 'open' | 'off'
  // The last working day before today.
  lastWorkingDay: { date: IsoDate; filled: boolean } | null
  // Whether all of last week's or last month's working days are filled; null with none.
  lastWeek: boolean | null
  lastMonth: boolean | null
  // Whether every working day before today, back to the start of last month, is filled.
  caughtUp: boolean
  // Working days in a row before today with nothing logged.
  emptyDays: number
  // Filled working days in a row, ending today or, while today isn't filled, before it.
  streak: number
}

// The summary as the pick reads it: the running timer's time at the pick, and whether it
// started on an earlier day.
export type FillFacts = FillSummary & { timerMs: number | null; timerOvernight: boolean }

type Entry = { startedAt: Date; stoppedAt: Date | null }

type Options = {
  now: number
  timeZone: string
  weekStart: WeekStart
  region: Region
  // The day the account was created: days before it aren't expected.
  since: IsoDate
}

// The span the summary reads entries from: the start of last month to now.
export function fillRange(now: number, timeZone: string): Range {
  const lastMonth = monthDates(addDays(monthDates(localDate(now, timeZone)).from, -1)).from
  return { from: startOfDay(lastMonth, timeZone), to: now }
}

export function fillSummary(entries: Entry[], options: Options): FillSummary {
  const { now, timeZone, weekStart, region, since } = options
  const range = fillRange(now, timeZone)
  const logged = new Map<IsoDate, number>()
  for (const entry of entries) {
    const span = countedSpan(entry, range, now)
    if (!span) continue
    for (const piece of splitByDay(span.from, span.to, timeZone)) {
      logged.set(piece.date, (logged.get(piece.date) ?? 0) + piece.ms)
    }
  }
  function expected(date: IsoDate) {
    return date >= since && isWorkingDay(date, region)
  }
  function filled(date: IsoDate) {
    return (logged.get(date) ?? 0) >= FILLED_MS - (isShortDay(date, region) ? SHORT_DAY_MS : 0)
  }
  // Every expected day in the dates is filled, or null when none is expected.
  function allFilled(dates: IsoDate[]) {
    const days = dates.filter(expected)
    return days.length > 0 ? days.every(filled) : null
  }

  const date = localDate(now, timeZone)
  // The expected days before today, newest first.
  const before = datesBetween(localDate(range.from, timeZone), date).filter(expected).toReversed()
  const today = !expected(date) ? 'off' : filled(date) ? 'filled' : 'open'
  const lastWeekStart = addDays(startOfWeek(date, weekStart), -7)
  const thisMonth = monthDates(date).from
  const running = entries.find((entry) => !entry.stoppedAt)
  return {
    date,
    timerStartedAt: running ? running.startedAt.getTime() : null,
    today,
    lastWorkingDay: before[0] ? { date: before[0], filled: filled(before[0]) } : null,
    lastWeek: allFilled(datesBetween(lastWeekStart, addDays(lastWeekStart, 7))),
    lastMonth: allFilled(datesBetween(monthDates(addDays(thisMonth, -1)).from, thisMonth)),
    caughtUp: before.every(filled),
    emptyDays: leading(before, (day) => !logged.has(day)),
    streak: (today === 'filled' ? 1 : 0) + leading(before, filled),
  }
}

// How many of the first items match, up to the first that doesn't.
function leading<T>(items: T[], match: (item: T) => boolean) {
  const index = items.findIndex((item) => !match(item))
  return index === -1 ? items.length : index
}
