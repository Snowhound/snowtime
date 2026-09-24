/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import {
  addDays,
  countedSpan,
  datesBetween,
  dayRange,
  daysBetween,
  localDate,
  offsetAt,
  splitByDay,
  startOfWeek,
  weekRange,
} from './calendar'

const HOUR = 3_600_000
function at(iso: string) {
  return Date.parse(iso)
}
function iso(range: { from: number; to: number }) {
  return {
    from: new Date(range.from).toISOString(),
    to: new Date(range.to).toISOString(),
    hours: (range.to - range.from) / HOUR,
  }
}

describe('dates', () => {
  test('addDays, daysBetween and datesBetween cross month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(daysBetween('2026-09-01', '2026-10-01')).toBe(30)
    expect(datesBetween('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ])
    expect(datesBetween('2026-09-29', '2026-09-29')).toEqual([])
  })

  test('rejects dates that are not ISO calendar dates', () => {
    for (const bad of ['2026-02-30', '2026-9-1', '20260901', '']) {
      expect(() => addDays(bad, 1)).toThrow(RangeError)
    }
  })

  test('startOfWeek follows the week start', () => {
    // Thursday.
    expect(startOfWeek('2026-09-24', 'mon')).toBe('2026-09-21')
    expect(startOfWeek('2026-09-24', 'sun')).toBe('2026-09-20')
    expect(startOfWeek('2026-09-21', 'mon')).toBe('2026-09-21')
    expect(startOfWeek('2026-09-20', 'mon')).toBe('2026-09-14')
    expect(startOfWeek('2026-09-20', 'sun')).toBe('2026-09-20')
    expect(startOfWeek('2027-01-02', 'mon')).toBe('2026-12-28')
  })

  test('localDate reads the day in the zone', () => {
    const instant = at('2026-09-23T22:30:00Z')
    expect(localDate(instant, 'UTC')).toBe('2026-09-23')
    expect(localDate(instant, 'Europe/Tallinn')).toBe('2026-09-24')
    expect(localDate(instant, 'America/New_York')).toBe('2026-09-23')
    expect(offsetAt(instant, 'Asia/Kolkata')).toBe(5.5 * HOUR)
  })
})

describe('dayRange', () => {
  test('an ordinary day is 24 hours from local midnight', () => {
    expect(iso(dayRange('2026-09-24', 'Europe/Tallinn'))).toEqual({
      from: '2026-09-23T21:00:00.000Z',
      to: '2026-09-24T21:00:00.000Z',
      hours: 24,
    })
    expect(iso(dayRange('2026-09-24', 'America/New_York')).from).toBe('2026-09-24T04:00:00.000Z')
  })

  test('the day clocks spring forward is 23 hours', () => {
    expect(iso(dayRange('2026-03-29', 'Europe/Tallinn'))).toEqual({
      from: '2026-03-28T22:00:00.000Z',
      to: '2026-03-29T21:00:00.000Z',
      hours: 23,
    })
    expect(iso(dayRange('2026-03-08', 'America/New_York')).hours).toBe(23)
  })

  test('the day clocks fall back is 25 hours', () => {
    expect(iso(dayRange('2026-10-25', 'Europe/Tallinn'))).toEqual({
      from: '2026-10-24T21:00:00.000Z',
      to: '2026-10-25T22:00:00.000Z',
      hours: 25,
    })
    expect(iso(dayRange('2026-11-01', 'America/New_York')).hours).toBe(25)
  })

  test('a skipped midnight starts the day when clocks spring forward', () => {
    // Havana springs forward from 00:00 to 01:00 on the second Sunday of March.
    expect(iso(dayRange('2026-03-08', 'America/Havana'))).toEqual({
      from: '2026-03-08T05:00:00.000Z',
      to: '2026-03-09T04:00:00.000Z',
      hours: 23,
    })
  })

  test('a repeated midnight starts the day at its first occurrence', () => {
    // Havana falls back from 01:00 to 00:00 on the first Sunday of November.
    expect(iso(dayRange('2026-11-01', 'America/Havana'))).toEqual({
      from: '2026-11-01T04:00:00.000Z',
      to: '2026-11-02T05:00:00.000Z',
      hours: 25,
    })
  })

  test('consecutive days tile time with no gap or overlap', () => {
    for (const zone of [
      'Europe/Tallinn',
      'America/Havana',
      'Australia/Lord_Howe',
      'Asia/Kathmandu',
    ]) {
      for (const date of datesBetween('2026-01-01', '2027-01-01')) {
        const day = dayRange(date, zone)
        expect(day.to).toBe(dayRange(addDays(date, 1), zone).from)
        expect(localDate(day.from, zone)).toBe(date)
        expect(localDate(day.to - 1, zone)).toBe(date)
      }
    }
  })
})

describe('weekRange', () => {
  test('a week spans seven local days from the week start', () => {
    expect(iso(weekRange('2026-09-24', 'Europe/Tallinn', 'mon'))).toEqual({
      from: '2026-09-20T21:00:00.000Z',
      to: '2026-09-27T21:00:00.000Z',
      hours: 168,
    })
    expect(iso(weekRange('2026-09-24', 'Europe/Tallinn', 'sun')).from).toBe(
      '2026-09-19T21:00:00.000Z',
    )
  })

  test('a week holding a clock change is an hour shorter or longer', () => {
    expect(iso(weekRange('2026-03-25', 'Europe/Tallinn', 'mon')).hours).toBe(167)
    expect(iso(weekRange('2026-10-21', 'Europe/Tallinn', 'mon')).hours).toBe(169)
    // With a Sunday start, New York's change falls on the week's first day.
    expect(iso(weekRange('2026-11-01', 'America/New_York', 'sun'))).toEqual({
      from: '2026-11-01T04:00:00.000Z',
      to: '2026-11-08T05:00:00.000Z',
      hours: 169,
    })
  })
})

describe('splitByDay', () => {
  test('an entry within a day is one piece', () => {
    expect(
      splitByDay(at('2026-09-24T06:00:00Z'), at('2026-09-24T08:30:00Z'), 'Europe/Tallinn'),
    ).toEqual([{ date: '2026-09-24', ms: 2.5 * HOUR }])
  })

  test('an entry crossing local midnight splits there, not at UTC midnight', () => {
    // 23:30 to 02:15 in Tallinn.
    expect(
      splitByDay(at('2026-09-23T20:30:00Z'), at('2026-09-23T23:15:00Z'), 'Europe/Tallinn'),
    ).toEqual([
      { date: '2026-09-23', ms: 0.5 * HOUR },
      { date: '2026-09-24', ms: 2.25 * HOUR },
    ])
    expect(splitByDay(at('2026-09-23T20:30:00Z'), at('2026-09-23T23:15:00Z'), 'UTC')).toEqual([
      { date: '2026-09-23', ms: 2.75 * HOUR },
    ])
  })

  test('a multi-day entry gives each day its share, DST included', () => {
    // Friday 22:00 to Monday 02:00 in Tallinn, over the spring-forward Sunday.
    const pieces = splitByDay(
      at('2026-03-27T20:00:00Z'),
      at('2026-03-30T00:00:00Z'),
      'Europe/Tallinn',
    )
    expect(pieces).toEqual([
      { date: '2026-03-27', ms: 2 * HOUR },
      { date: '2026-03-28', ms: 24 * HOUR },
      { date: '2026-03-29', ms: 23 * HOUR },
      { date: '2026-03-30', ms: 3 * HOUR },
    ])
  })

  test('an empty or reversed span has no pieces', () => {
    expect(splitByDay(at('2026-09-24T06:00:00Z'), at('2026-09-24T06:00:00Z'), 'UTC')).toEqual([])
    expect(splitByDay(at('2026-09-24T07:00:00Z'), at('2026-09-24T06:00:00Z'), 'UTC')).toEqual([])
  })
})

describe('countedSpan', () => {
  const range = { from: at('2026-09-24T00:00:00Z'), to: at('2026-09-25T00:00:00Z') }
  const now = at('2026-09-24T12:00:00Z')
  function entry(startedAt: string, stoppedAt: string | null) {
    return {
      startedAt: new Date(startedAt),
      stoppedAt: stoppedAt ? new Date(stoppedAt) : null,
    }
  }

  test('a running entry counts up to now', () => {
    expect(countedSpan(entry('2026-09-24T11:15:00Z', null), range, now)).toEqual({
      from: at('2026-09-24T11:15:00Z'),
      to: now,
    })
    // A running entry started before the range counts from the range start.
    expect(countedSpan(entry('2026-09-23T20:00:00Z', null), range, now)).toEqual({
      from: range.from,
      to: now,
    })
  })

  test('an entry is clipped to the range', () => {
    expect(countedSpan(entry('2026-09-23T22:00:00Z', '2026-09-24T01:00:00Z'), range, now)).toEqual({
      from: range.from,
      to: at('2026-09-24T01:00:00Z'),
    })
    expect(countedSpan(entry('2026-09-24T23:00:00Z', '2026-09-25T02:00:00Z'), range, now)).toEqual({
      from: at('2026-09-24T23:00:00Z'),
      to: range.to,
    })
  })

  test('nothing counts outside the range or before a running entry starts', () => {
    expect(
      countedSpan(entry('2026-09-23T10:00:00Z', '2026-09-24T00:00:00Z'), range, now),
    ).toBeNull()
    expect(countedSpan(entry('2026-09-24T13:00:00Z', null), range, now)).toBeNull()
  })
})
