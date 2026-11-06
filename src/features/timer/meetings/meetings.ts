// The rules for showing and logging calendar events (task 097.02, prototypes/calendar-events.html):
// which are logged already, which start checked in Log meetings, and the entries an all-day
// event logs as.
import { type IsoDate, type Range, addDays, atLocalTime, localDate } from '~/lib/calendar'
import { type Region, isWorkingDay } from '~/lib/holidays/holidays'
import { detectTicket } from '~/lib/tickets'
import {
  allDayKey,
  type CalendarEvent,
  type CalendarEvents,
  type CalendarLog,
} from '~/server/calendar/calendar.schemas'

// An all-day event logs as a day of this length from this time; the user moves it after.
export const DAY_START = '09:00'
export const DAY_HOURS = 8

// One entry an event logs as: the event's own key and times, or a day of an all-day event.
export interface Loggable {
  event: CalendarEvent
  key: string
  startedAt: number
  stoppedAt: number
  // The day, for an all-day event.
  date?: IsoDate
}

// What the user did with a key: logged here, in another organization, or logged and deleted.
export type LogState = 'here' | 'elsewhere' | 'deleted' | null

export function logState(
  key: string,
  entryKeys: ReadonlySet<string>,
  logs: readonly CalendarLog[],
  organizationId: string,
): LogState {
  if (entryKeys.has(key)) return 'here'
  const log = logs.find((l) => l.calendarEvent === key)
  if (!log) return null
  if (log.deleted) return 'deleted'
  // Logged here but outside the entries loaded, such as a range the dialog reads.
  return log.organizationId === organizationId ? 'here' : 'elsewhere'
}

// The days an all-day event logs as. One that covers several days leaves out weekends and
// holidays, so a week's vacation logs its workdays.
export function dayLogs(event: CalendarEvent, zone: string, region: Region): Loggable[] {
  const first = localDate(event.startedAt.getTime(), zone)
  const last = localDate(event.stoppedAt.getTime() - 1, zone)
  const dates: IsoDate[] = []
  for (let d = first; d <= last; d = addDays(d, 1)) dates.push(d)
  const days = dates.length > 1 ? dates.filter((d) => isWorkingDay(d, region)) : dates
  return days.map((date) => {
    const startedAt = atLocalTime(date, DAY_START, zone)
    return {
      event,
      key: allDayKey(event.key, date),
      startedAt,
      stoppedAt: startedAt + DAY_HOURS * 3_600_000,
      date,
    }
  })
}

export function timedLog(event: CalendarEvent): Loggable {
  return {
    event,
    key: event.key,
    startedAt: event.startedAt.getTime(),
    stoppedAt: event.stoppedAt.getTime(),
  }
}

// Why auto-track would leave an event out, or null when it logs it. Log meetings starts the
// others checked once they have started. Unanswered invitations count.
export type SkipReason =
  | 'all_day'
  | 'working_location'
  | 'out_of_office'
  | 'focus_time'
  | 'declined'
  | 'free'

export function skipReason(event: CalendarEvent): SkipReason | null {
  if (event.kind === 'working_location') return 'working_location'
  if (event.allDay) return 'all_day'
  if (event.kind === 'out_of_office') return 'out_of_office'
  if (event.kind === 'focus_time') return 'focus_time'
  if (event.response === 'declined') return 'declined'
  if (event.free) return 'free'
  return null
}

export function startsChecked(item: Loggable, state: LogState, now: number) {
  return !item.event.allDay && item.startedAt <= now && !skipReason(item.event) && state === null
}

// The entries a range of Log meetings lists: each timed event that starts in it, and each day
// of an all-day event in it. Working locations aren't listed.
export function loggablesIn(
  events: readonly CalendarEvent[],
  range: Range,
  zone: string,
  region: Region,
): Loggable[] {
  return events
    .filter((e) => e.kind !== 'working_location')
    .flatMap((e) =>
      e.allDay
        ? dayLogs(e, zone, region).filter(
            (d) => d.startedAt >= range.from && d.startedAt < range.to,
          )
        : e.startedAt.getTime() >= range.from && e.startedAt.getTime() < range.to
          ? [timedLog(e)]
          : [],
    )
    .sort(
      (a, b) =>
        localDate(a.startedAt, zone).localeCompare(localDate(b.startedAt, zone)) ||
        Number(b.event.allDay) - Number(a.event.allDay) ||
        a.startedAt - b.startedAt,
    )
}

// An entry's description and ticket from the event's title, as a typed description finds a
// ticket key in it.
export function workOf(event: CalendarEvent) {
  return detectTicket(event.title, new Set(), null)
}

// The project a meeting suggests: that of the user's latest entry with the same description,
// if the project is still active.
export function suggestProject(
  event: CalendarEvent,
  entries: readonly { description: string; projectId: string | null; startedAt: Date }[],
  projects: readonly { id: string }[],
) {
  const { description } = workOf(event)
  let latest: (typeof entries)[number] | undefined
  for (const entry of entries) {
    if (entry.description !== description) continue
    if (!latest || entry.startedAt > latest.startedAt) latest = entry
  }
  const projectId = latest?.projectId
  return projectId && projects.some((p) => p.id === projectId) ? projectId : null
}

export function connectionNeedsReconnect(answer: CalendarEvents | undefined) {
  return !!answer?.connections.some((c) => c.status === 'reconnect')
}
