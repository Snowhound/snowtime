// Time entry rules the timer view applies on the client (prototypes/timer.html): grouping
// by day in the user's zone, the recent work and the summary, and reading the entry
// popover's date and times.
import {
  type IsoDate,
  type Range,
  type WeekStart,
  addDays,
  atLocalTime,
  countedSpan,
  dayRange,
  localDate,
  localTime,
  startOfDay,
  weekRange,
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

// The newest entries with distinct descriptions and projects, for "Continue recent".
// Entries without a description are left out: there is nothing to tell them apart by.
export function recentWork<
  T extends EntryTimes & { description: string; projectId: string | null },
>(entries: readonly T[], limit = 5) {
  const seen = new Set<string>()
  const recent: T[] = []
  const sorted = [...entries].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
  for (const entry of sorted) {
    const key = JSON.stringify([entry.description, entry.projectId])
    if (!entry.description || seen.has(key)) continue
    seen.add(key)
    recent.push(entry)
    if (recent.length === limit) break
  }
  return recent
}

// Recent work whose description contains the typed text, for the description fields'
// suggestions (prototypes/timer.html): newest first, leaving out the pair already in the
// fields and work whose project can't be picked any more.
export function suggestWork<
  T extends EntryTimes & { description: string; projectId: string | null },
>(
  entries: readonly T[],
  typed: { description: string; projectId: string | null },
  pickable: (projectId: string | null) => boolean,
  limit = 8,
) {
  const text = typed.description.trim()
  const query = text.toLocaleLowerCase()
  return recentWork(entries, Infinity)
    .filter(
      (e) =>
        pickable(e.projectId) &&
        e.description.toLocaleLowerCase().includes(query) &&
        !(e.description === text && e.projectId === typed.projectId),
    )
    .slice(0, limit)
}

// A new entry's default start: the end of today's last stopped entry in the zone, so
// filling the gap after it needs only an end. Empty when nothing ended today.
export function lastEndToday(entries: readonly EntryTimes[], zone: string, now = Date.now()) {
  const today = localDate(now, zone)
  let last: number | null = null
  for (const { stoppedAt } of entries) {
    const end = stoppedAt?.getTime()
    if (end !== undefined && localDate(end, zone) === today && (last === null || end > last)) {
      last = end
    }
  }
  return last === null ? '' : localTime(last, zone)
}

export interface Summary {
  today: number
  week: number
  // This week's time per project, most first; projectId null is time without a project.
  projects: { projectId: string | null; total: number }[]
}

// Today's and this week's time in the zone, and the week's time per project. As in
// reports, entries are clipped to the day or week and a running entry counts up to now.
export function summarize(
  entries: readonly (EntryTimes & { projectId: string | null })[],
  options: { zone: string; weekStart: WeekStart; now?: number },
): Summary {
  const { zone, weekStart, now = Date.now() } = options
  const today = localDate(now, zone)
  const day = dayRange(today, zone)
  const week = weekRange(today, zone, weekStart)
  const summary: Summary = { today: 0, week: 0, projects: [] }
  const byProject = new Map<string | null, number>()
  for (const entry of entries) {
    const inDay = countedSpan(entry, day, now)
    if (inDay) summary.today += inDay.to - inDay.from
    const inWeek = countedSpan(entry, week, now)
    if (!inWeek) continue
    summary.week += inWeek.to - inWeek.from
    byProject.set(entry.projectId, (byProject.get(entry.projectId) ?? 0) + inWeek.to - inWeek.from)
  }
  summary.projects = [...byProject]
    .map(([projectId, total]) => ({ projectId, total }))
    .sort((a, b) => b.total - a.total)
  return summary
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

// Reads the entry popover's date, start, and end (values of date and time inputs) as instants in
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
