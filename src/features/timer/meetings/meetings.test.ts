import { describe, expect, test } from 'bun:test'
import { startOfDay } from '~/lib/calendar'
import type { CalendarEvent } from '~/server/calendar/calendar.schemas'
import {
  dayLogs,
  loggablesIn,
  logState,
  skipReason,
  startsChecked,
  suggestProject,
  timedLog,
} from './meetings'

const ZONE = 'Europe/Tallinn'
const ORG = 'org-1'

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    key: 'google:anna@snowhound.eu:ev1',
    seriesKey: null,
    sourceId: 'source-1',
    title: 'Standup',
    startedAt: new Date('2026-11-03T07:30:00Z'),
    stoppedAt: new Date('2026-11-03T07:45:00Z'),
    allDay: false,
    free: false,
    response: 'accepted',
    kind: 'event',
    ...overrides,
  }
}

function allDay(first: string, after: string, overrides: Partial<CalendarEvent> = {}) {
  return event({
    key: 'google:anna@snowhound.eu:trip',
    title: 'Conference',
    startedAt: new Date(startOfDay(first, ZONE)),
    stoppedAt: new Date(startOfDay(after, ZONE)),
    allDay: true,
    ...overrides,
  })
}

describe('logState', () => {
  const key = event().key
  function log(organizationId: string, deleted = false) {
    return [{ calendarEvent: key, entryId: 'e1', organizationId, deleted }]
  }

  test('a loaded entry with the key is logged here', () => {
    expect(logState(key, new Set([key]), [], ORG)).toBe('here')
  })

  test("the server's logs tell another organization, a deleted entry, and one outside the loaded entries", () => {
    expect(logState(key, new Set(), log('org-2'), ORG)).toBe('elsewhere')
    expect(logState(key, new Set(), log(ORG, true), ORG)).toBe('deleted')
    expect(logState(key, new Set(), log(ORG), ORG)).toBe('here')
    expect(logState(key, new Set(), [], ORG)).toBeNull()
  })
})

describe('dayLogs', () => {
  test('a one-day event logs 8 h from 09:00 with a key per date', () => {
    const [day] = dayLogs(allDay('2026-11-07', '2026-11-08'), ZONE, 'EE')
    expect(day.key).toBe('google:anna@snowhound.eu:trip:2026-11-07')
    expect(new Date(day.startedAt)).toEqual(new Date('2026-11-07T07:00:00Z'))
    expect(day.stoppedAt - day.startedAt).toBe(8 * 3_600_000)
  })

  test('an event over several days logs its workdays only', () => {
    // Thursday to the next Tuesday: the weekend is left out.
    const days = dayLogs(allDay('2026-11-05', '2026-11-11'), ZONE, 'EE')
    expect(days.map((d) => d.date)).toEqual([
      '2026-11-05',
      '2026-11-06',
      '2026-11-09',
      '2026-11-10',
    ])
  })

  test('a single day on a weekend still logs, since the user asked for it', () => {
    expect(dayLogs(allDay('2026-11-07', '2026-11-08'), ZONE, 'EE')).toHaveLength(1)
  })
})

describe('skipReason and startsChecked', () => {
  const now = new Date('2026-11-03T12:00:00Z').getTime()

  test('declined, free, focus time, out of office, and all-day events are skipped', () => {
    expect(skipReason(event({ response: 'declined' }))).toBe('declined')
    expect(skipReason(event({ free: true }))).toBe('free')
    expect(skipReason(event({ kind: 'focus_time' }))).toBe('focus_time')
    expect(skipReason(event({ kind: 'out_of_office' }))).toBe('out_of_office')
    expect(skipReason(allDay('2026-11-03', '2026-11-04'))).toBe('all_day')
    expect(skipReason(event({ response: 'none' }))).toBeNull()
  })

  test('a started meeting nobody logged starts checked; one to come or logged does not', () => {
    expect(startsChecked(timedLog(event()), null, now)).toBe(true)
    expect(startsChecked(timedLog(event()), 'deleted', now)).toBe(false)
    const later = event({
      startedAt: new Date('2026-11-03T13:00:00Z'),
      stoppedAt: new Date('2026-11-03T14:00:00Z'),
    })
    expect(startsChecked(timedLog(later), null, now)).toBe(false)
  })
})

describe('loggablesIn', () => {
  test("lists a range's days in order, all-day first, without working locations", () => {
    const range = {
      from: startOfDay('2026-11-03', ZONE),
      to: startOfDay('2026-11-05', ZONE),
    }
    const items = loggablesIn(
      [
        event({
          key: 'k:late',
          startedAt: new Date('2026-11-04T12:00:00Z'),
          stoppedAt: new Date('2026-11-04T13:00:00Z'),
        }),
        event({ key: 'k:early' }),
        event({ key: 'k:office', kind: 'working_location' }),
        allDay('2026-11-04', '2026-11-05'),
        event({
          key: 'k:outside',
          startedAt: new Date('2026-11-06T08:00:00Z'),
          stoppedAt: new Date('2026-11-06T09:00:00Z'),
        }),
      ],
      range,
      ZONE,
      'EE',
    )
    expect(items.map((i) => i.key)).toEqual([
      'k:early',
      'google:anna@snowhound.eu:trip:2026-11-04',
      'k:late',
    ])
  })
})

describe('suggestProject', () => {
  function entry(description: string, projectId: string | null, startedAt: string) {
    return { description, projectId, startedAt: new Date(startedAt) }
  }
  const projects = [{ id: 'p-1' }, { id: 'p-2' }]

  test("takes the project of the latest entry with the meeting's title", () => {
    const entries = [
      entry('Standup', 'p-1', '2026-11-02T07:30:00Z'),
      entry('Standup', 'p-2', '2026-10-30T07:30:00Z'),
      entry('Review', 'p-2', '2026-11-03T07:30:00Z'),
    ]
    expect(suggestProject(event(), entries, projects)).toBe('p-1')
  })

  test('suggests none without a match, or when the project is no longer active', () => {
    expect(
      suggestProject(event(), [entry('Review', 'p-1', '2026-11-02T07:30:00Z')], projects),
    ).toBeNull()
    expect(
      suggestProject(event(), [entry('Standup', 'p-archived', '2026-11-02T07:30:00Z')], projects),
    ).toBeNull()
  })
})
