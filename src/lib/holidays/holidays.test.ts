import { describe, expect, test } from 'bun:test'
import { datesBetween } from '~/lib/calendar'
import EE from './ee.json'
import { isShortDay, isWorkingDay } from './holidays'

// The weekdays of the year that aren't working days in the region.
function weekdaysOff(year: number, region: string) {
  return datesBetween(`${year}-01-01`, `${year + 1}-01-01`).filter((date) => {
    const day = new Date(date).getUTCDay()
    return day !== 0 && day !== 6 && !isWorkingDay(date, region)
  })
}

describe('ee.json', () => {
  // Run `bun run holidays:update` when this fails. riigipühad.ee lists several years ahead.
  test('covers the next calendar year', () => {
    const next = new Date().getUTCFullYear() + 1
    expect(EE.some((d) => d.date === `${next}-12-26`)).toBe(true)
  })

  test('holds dates in order, each a day off or a short day', () => {
    const dates = EE.map((d) => d.date)
    expect(dates).toEqual([...dates].sort())
    expect(new Set(dates).size).toBe(dates.length)
    for (const d of EE) expect(['off', 'short']).toContain(d.kind)
  })
})

describe('isWorkingDay', () => {
  test('never counts a weekend, in any region', () => {
    for (const region of ['EE', 'US', 'FI']) {
      expect(isWorkingDay('2026-10-03', region)).toBe(false) // A Saturday.
      expect(isWorkingDay('2026-10-04', region)).toBe(false)
      expect(isWorkingDay('2026-10-05', region)).toBe(true)
    }
  })

  test("skips Estonia's days off", () => {
    expect(weekdaysOff(2026, 'EE')).toEqual([
      '2026-01-01',
      '2026-02-24',
      '2026-04-03',
      '2026-05-01',
      '2026-06-23',
      '2026-06-24',
      '2026-08-20',
      '2026-12-24',
      '2026-12-25',
    ])
  })

  test('counts only weekends in other regions', () => {
    expect(weekdaysOff(2026, 'FI')).toEqual([])
  })

  // The federal dates from opm.gov, without Columbus Day and Veterans Day, plus the Friday
  // after Thanksgiving and Christmas Eve.
  test('follows the US federal dates in 2026', () => {
    expect(weekdaysOff(2026, 'US')).toEqual([
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-05-25',
      '2026-06-19',
      '2026-07-03', // 4 July is a Saturday.
      '2026-09-07',
      '2026-11-26',
      '2026-11-27',
      '2026-12-24',
      '2026-12-25',
    ])
  })

  test('follows the US federal dates in 2027', () => {
    expect(weekdaysOff(2027, 'US')).toEqual([
      '2027-01-01',
      '2027-01-18',
      '2027-02-15',
      '2027-05-31',
      '2027-06-18', // 19 June is a Saturday.
      '2027-07-05', // 4 July is a Sunday.
      '2027-09-06',
      '2027-11-25',
      '2027-11-26',
      '2027-12-23', // Christmas moves onto the 24th, so Christmas Eve moves to the 23rd.
      '2027-12-24', // 25 December is a Saturday.
      '2027-12-31', // New Year's Day 2028 is a Saturday.
    ])
  })

  test('keeps Christmas Eve apart from Christmas when the 24th is a Sunday', () => {
    // 2023: Christmas is on Monday the 25th, so Christmas Eve is the Friday before.
    expect(isWorkingDay('2023-12-22', 'US')).toBe(false)
    expect(isWorkingDay('2023-12-26', 'US')).toBe(true)
  })
})

describe('isShortDay', () => {
  test("marks Estonia's shortened days, which are still working days", () => {
    expect(isShortDay('2026-12-23', 'EE')).toBe(true)
    expect(isWorkingDay('2026-12-23', 'EE')).toBe(true)
    expect(isShortDay('2026-12-22', 'EE')).toBe(false)
    expect(isShortDay('2026-12-23', 'US')).toBe(false)
  })
})
