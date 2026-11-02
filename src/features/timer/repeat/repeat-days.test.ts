import { describe, expect, test } from 'bun:test'
import { atLocalTime } from '~/lib/calendar'
import {
  type CopyBase,
  addMonths,
  copyTimes,
  defaultUntil,
  patternDays,
  monthCells,
} from './repeat-days'

const zone = 'Europe/Tallinn'
// Monday 5 October 2026, 08:30 for 25 minutes.
const base: CopyBase = {
  date: '2026-10-05',
  startedAt: atLocalTime('2026-10-05', '08:30', zone) + 12_000,
  length: 25 * 60_000,
}

describe('copyTimes', () => {
  test('keeps the wall-clock start, its seconds, and the length across a clock change', () => {
    // Clocks go back on 25 October 2026.
    const copy = copyTimes(base, '2026-10-26', zone)
    expect(copy.startedAt).toBe(atLocalTime('2026-10-26', '08:30', zone) + 12_000)
    expect(copy.stoppedAt - copy.startedAt).toBe(base.length)
  })
})

describe('defaultUntil', () => {
  test("the end of the entry's month, a month later weekly, six months later monthly", () => {
    expect(defaultUntil('workday', '2026-10-05')).toBe('2026-10-31')
    expect(defaultUntil('day', '2026-10-05')).toBe('2026-10-31')
    expect(defaultUntil('week', '2026-10-05')).toBe('2026-11-30')
    expect(defaultUntil('month', '2026-10-05')).toBe('2027-03-31')
  })
})

describe('patternDays', () => {
  function none() {
    return false
  }

  test("every workday leaves out weekends and the country's public holidays", () => {
    const { added } = patternDays({
      pattern: 'workday',
      base: { ...base, date: '2026-12-21' },
      until: '2026-12-31',
      region: 'EE',
      has: none,
    })
    // Christmas Eve to Boxing Day are Estonian holidays.
    expect(added).toEqual([
      '2026-12-22',
      '2026-12-23',
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
    ])
  })

  test('the same weekday, or the same day of the month', () => {
    expect(
      patternDays({ pattern: 'week', base, until: '2026-10-31', region: 'other', has: none }).added,
    ).toEqual(['2026-10-12', '2026-10-19', '2026-10-26'])
    expect(
      patternDays({
        pattern: 'month',
        base: { ...base, date: '2026-01-31' },
        until: '2026-05-31',
        region: 'other',
        has: none,
      }).added,
    ).toEqual(['2026-03-31', '2026-05-31'])
  })

  test('days that already have the entry are left out and counted', () => {
    const result = patternDays({
      pattern: 'day',
      base,
      until: '2026-10-08',
      region: 'other',
      has: (date) => date === '2026-10-07',
    })
    expect(result).toEqual({ added: ['2026-10-06', '2026-10-08'], had: 1 })
  })
})

describe('monthCells', () => {
  test('whole weeks from the week start, with days outside the month empty', () => {
    const cells = monthCells('2026-10-05', 'mon')
    expect(cells).toHaveLength(35)
    expect(cells.slice(0, 4)).toEqual([null, null, null, '2026-10-01'])
    expect(cells.at(-1)).toBeNull()
    expect(cells.at(-2)).toBe('2026-10-31')
    expect(monthCells('2026-10-05', 'sun').slice(0, 5)).toEqual([
      null,
      null,
      null,
      null,
      '2026-10-01',
    ])
  })
})

describe('addMonths', () => {
  test('the first day of a month before or after', () => {
    expect(addMonths('2026-10-15', 1)).toBe('2026-11-01')
    expect(addMonths('2026-10-15', -1)).toBe('2026-09-01')
    expect(addMonths('2026-01-31', -2)).toBe('2025-11-01')
  })
})
