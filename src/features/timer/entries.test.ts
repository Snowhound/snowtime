import { describe, expect, test } from 'bun:test'
import {
  groupByDay,
  lastEndToday,
  readEntryTimes,
  recentRange,
  recentWork,
  suggestWork,
  summarize,
} from './entries'

const zone = 'Europe/Tallinn'
const now = Date.parse('2026-09-24T12:00:00Z') // 15:00 in Tallinn

function entry(start: string, stop: string | null) {
  return { startedAt: new Date(start), stoppedAt: stop ? new Date(stop) : null }
}

describe('groupByDay', () => {
  test('groups by start day in the zone, newest first, totalling stopped entries', () => {
    const late = entry('2026-09-23T20:30:00Z', '2026-09-23T22:00:00Z') // 23:30 on the 23rd
    const early = entry('2026-09-23T21:30:00Z', '2026-09-23T22:30:00Z') // 00:30 on the 24th
    const running = entry('2026-09-24T09:00:00Z', null)
    const groups = groupByDay([late, running, early], zone)

    expect(groups.map((g) => g.date)).toEqual(['2026-09-24', '2026-09-23'])
    expect(groups[0].entries).toEqual([running, early])
    expect(groups[0].total).toBe(3_600_000)
    expect(groups[1].total).toBe(5_400_000)
  })
})

describe('recentRange', () => {
  test('ends at the end of today and starts days - 1 days earlier, in the zone', () => {
    const range = recentRange(zone, 14, now)
    expect(new Date(range.from).toISOString()).toBe('2026-09-10T21:00:00.000Z')
    expect(new Date(range.to).toISOString()).toBe('2026-09-24T21:00:00.000Z')
  })
})

describe('recentWork', () => {
  function work(start: string, description: string, projectId: string | null) {
    return { ...entry(start, start), description, projectId }
  }

  test('the newest entry of each description and project, without blank descriptions', () => {
    const newest = work('2026-09-24T09:00:00Z', 'Review', 'p1')
    const otherProject = work('2026-09-24T08:00:00Z', 'Review', 'p2')
    const older = work('2026-09-23T09:00:00Z', 'Review', 'p1')
    const blank = work('2026-09-24T10:00:00Z', '', 'p1')
    expect(recentWork([older, blank, otherProject, newest])).toEqual([newest, otherProject])
  })

  test('stops at the limit', () => {
    const entries = ['a', 'b', 'c'].map((d, i) => work(`2026-09-2${i}T09:00:00Z`, d, null))
    expect(recentWork(entries, 2).map((e) => e.description)).toEqual(['c', 'b'])
  })
})

describe('suggestWork', () => {
  function work(start: string, description: string, projectId: string | null) {
    return { ...entry(start, start), description, projectId }
  }
  const review = work('2026-09-24T09:00:00Z', 'Code review', 'p1')
  const archived = work('2026-09-24T08:00:00Z', 'Review copy', 'old')
  const planning = work('2026-09-23T09:00:00Z', 'Planning', null)
  function pickable(id: string | null) {
    return id !== 'old'
  }

  test('newest work containing the text in any case, without unpickable projects', () => {
    const entries = [planning, archived, review]
    expect(suggestWork(entries, { description: ' REV', projectId: null }, pickable)).toEqual([
      review,
    ])
    expect(suggestWork(entries, { description: '', projectId: null }, pickable)).toEqual([
      review,
      planning,
    ])
  })

  test('leaves out the pair already in the fields, but not the same text elsewhere', () => {
    const other = work('2026-09-22T09:00:00Z', 'Code review', 'p2')
    const typed = { description: 'Code review', projectId: 'p1' }
    expect(suggestWork([review, other], typed, pickable)).toEqual([other])
  })
})

describe('lastEndToday', () => {
  test('the latest end today in the zone, or empty when nothing ended today', () => {
    const morning = entry('2026-09-24T06:00:00Z', '2026-09-24T07:30:00Z') // ends 10:30
    const noon = entry('2026-09-24T08:00:00Z', '2026-09-24T09:15:00Z') // ends 12:15
    const yesterday = entry('2026-09-23T19:00:00Z', '2026-09-23T20:00:00Z') // 23:00 on the 23rd
    const running = entry('2026-09-24T10:00:00Z', null)
    expect(lastEndToday([morning, noon, yesterday, running], zone, now)).toBe('12:15')
    expect(lastEndToday([yesterday, running], zone, now)).toBe('')
  })
})

describe('summarize', () => {
  // Thursday 24 September 2026, 15:00 in Tallinn. The week from Monday starts on the 21st
  // (the 20th at 21:00 UTC); from Sunday, on the 20th (the 19th at 21:00 UTC).
  function work(start: string, stop: string | null, projectId: string | null) {
    return { ...entry(start, stop), projectId }
  }

  test('clips entries to today and this week, and counts a running entry up to now', () => {
    const acrossMidnight = work('2026-09-23T20:00:00Z', '2026-09-23T22:00:00Z', 'p1') // 23:00–01:00
    const running = work('2026-09-24T11:30:00Z', null, 'p2')
    const acrossWeekStart = work('2026-09-20T20:00:00Z', '2026-09-20T22:00:00Z', null) // Sun 23:00–Mon 01:00
    const lastWeek = work('2026-09-18T09:00:00Z', '2026-09-18T10:00:00Z', 'p1')
    const summary = summarize([acrossMidnight, running, acrossWeekStart, lastWeek], {
      zone,
      weekStart: 'mon',
      now,
    })

    expect(summary.today).toBe(3_600_000 + 1_800_000)
    expect(summary.week).toBe(7_200_000 + 1_800_000 + 3_600_000)
    expect(summary.projects).toEqual([
      { projectId: 'p1', total: 7_200_000 },
      { projectId: null, total: 3_600_000 },
      { projectId: 'p2', total: 1_800_000 },
    ])
  })

  test('the week follows the week start', () => {
    const sunday = work('2026-09-20T09:00:00Z', '2026-09-20T10:00:00Z', 'p1')
    expect(summarize([sunday], { zone, weekStart: 'mon', now }).week).toBe(0)
    expect(summarize([sunday], { zone, weekStart: 'sun', now }).week).toBe(3_600_000)
  })
})

describe('readEntryTimes', () => {
  const options = { running: false, zone, now }

  test('reads the times in the zone', () => {
    expect(readEntryTimes({ date: '2026-09-24', start: '09:00', end: '10:30' }, options)).toEqual({
      startedAt: new Date('2026-09-24T06:00:00Z'),
      stoppedAt: new Date('2026-09-24T07:30:00Z'),
      nextDay: false,
    })
  })

  test('an end at or before the start is on the next day', () => {
    const result = readEntryTimes({ date: '2026-09-22', start: '22:00', end: '01:00' }, options)
    expect(result).toMatchObject({ stoppedAt: new Date('2026-09-22T22:00:00Z'), nextDay: true })
    expect(
      readEntryTimes({ date: '2026-09-22', start: '09:00', end: '09:00' }, options),
    ).toMatchObject({ nextDay: true })
  })

  test('a time left as it was keeps the seconds of the original entry', () => {
    const original = entry('2026-09-24T06:00:42Z', '2026-09-24T07:30:15Z')
    const values = { date: '2026-09-24', start: '09:00', end: '10:30' }
    expect(readEntryTimes(values, { ...options, original })).toMatchObject(original)
    expect(readEntryTimes({ ...values, end: '10:45' }, { ...options, original })).toMatchObject({
      startedAt: original.startedAt,
      stoppedAt: new Date('2026-09-24T07:45:00Z'),
    })
  })

  test('requires every time, and no end in the future', () => {
    expect(readEntryTimes({ date: '2026-09-24', start: '09:00', end: '' }, options)).toEqual({
      error: 'missing',
    })
    expect(readEntryTimes({ date: '2026-09-24', start: '14:00', end: '15:30' }, options)).toEqual({
      error: 'future',
    })
  })

  test('a running entry needs only a start, not in the future', () => {
    const running = { ...options, running: true }
    expect(readEntryTimes({ date: '2026-09-24', start: '14:00', end: '' }, running)).toEqual({
      startedAt: new Date('2026-09-24T11:00:00Z'),
      stoppedAt: null,
      nextDay: false,
    })
    expect(readEntryTimes({ date: '', start: '14:00', end: '' }, running)).toEqual({
      error: 'missing_running',
    })
    expect(readEntryTimes({ date: '2026-09-24', start: '15:01', end: '' }, running)).toEqual({
      error: 'running_future',
    })
  })
})
