// Time entry rules the timer view applies on the client (prototypes/timer.html): grouping
// by day in the user's zone, and reading the entry dialog's date and times.
import {
  type IsoDate,
  type Range,
  addDays,
  atLocalTime,
  localDate,
  startOfDay,
} from '~/lib/calendar'

export interface EntryTimes {
  startedAt: Date
  stoppedAt: Date | null
}

// The entries of one day, newest first, and the day's total.
export interface DayGroup<T> {
  date: IsoDate
  entries: T[]
  total: number
}

// Groups entries by the day they start in the zone, newest day first. Totals count stopped
// entries only; splitting an entry at midnight belongs to reports.
export function groupByDay<T extends EntryTimes>(entries: readonly T[], zone: string) {
  const groups = new Map<IsoDate, DayGroup<T>>()
  const sorted = [...entries].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
  for (const entry of sorted) {
    const date = localDate(entry.startedAt.getTime(), zone)
    let group = groups.get(date)
    if (!group) {
      group = { date, entries: [], total: 0 }
      groups.set(date, group)
    }
    group.entries.push(entry)
    if (entry.stoppedAt) group.total += entry.stoppedAt.getTime() - entry.startedAt.getTime()
  }
  return [...groups.values()]
}

// The last `days` days up to the end of today in the zone, for listEntries.
export function recentRange(zone: string, days: number, now = Date.now()): Range {
  const today = localDate(now, zone)
  return {
    from: startOfDay(addDays(today, -(days - 1)), zone),
    to: startOfDay(addDays(today, 1), zone),
  }
}

export interface EntryFormTimes {
  date: string
  start: string
  end: string
}

export type EntryFormError = 'missing' | 'missing_running' | 'future' | 'running_future'

export type EntryFormResult =
  | { error: EntryFormError }
  | { error?: undefined; startedAt: Date; stoppedAt: Date | null; nextDay: boolean }

// The instant read from a minute-precision input, or the original one when the input
// still shows its minute.
function keep(ms: number, original: Date | null | undefined) {
  const exact = original?.getTime()
  return exact !== undefined && exact - (exact % 60_000) === ms ? exact : ms
}

// Reads the dialog's date, start, and end (values of date and time inputs) as instants in
// the zone. A running entry has no end. An end at or before the start means the next day.
// Neither may lie in the future: a running entry can't start there, and an entry can't
// end there. The inputs hold whole minutes, so a time left as it was keeps the seconds of
// the `original` entry.
export function readEntryTimes(
  values: EntryFormTimes,
  options: { running: boolean; zone: string; now?: number; original?: EntryTimes },
): EntryFormResult {
  const { running, zone, now = Date.now(), original } = options
  if (!values.date || !values.start || (!running && !values.end)) {
    return { error: running ? 'missing_running' : 'missing' }
  }
  let startedAt: number
  try {
    startedAt = keep(atLocalTime(values.date, values.start, zone), original?.startedAt)
  } catch {
    return { error: running ? 'missing_running' : 'missing' }
  }
  if (running) {
    if (startedAt > now) return { error: 'running_future' }
    return { startedAt: new Date(startedAt), stoppedAt: null, nextDay: false }
  }
  let stoppedAt = keep(atLocalTime(values.date, values.end, zone), original?.stoppedAt)
  const nextDay = stoppedAt <= startedAt
  if (nextDay) {
    stoppedAt = keep(atLocalTime(addDays(values.date, 1), values.end, zone), original?.stoppedAt)
  }
  if (stoppedAt > now) return { error: 'future' }
  return { startedAt: new Date(startedAt), stoppedAt: new Date(stoppedAt), nextDay }
}
