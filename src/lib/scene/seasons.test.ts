import { describe, expect, test } from 'bun:test'
import { m } from '~/paraglide/messages.js'
import { PERIODS, SEASON_COPY, seasonLines, taglineLines } from './seasons'

const TALLINN = 'Europe/Tallinn'
const DAY = 86_400_000

function at(iso: string) {
  return Date.parse(iso)
}

// The first lines of the sets shown on `days` days from `from`.
function firstLines(from: string, days: number, when: Parameters<typeof seasonLines>[1] = {}) {
  return new Set(
    Array.from(
      { length: days },
      (_, d) => seasonLines('autumn', { ...when, now: at(from) + d * DAY })[0],
    ),
  )
}

function tagline(iso: string, locale: 'en' | 'et' = 'en') {
  return taglineLines('autumn', { now: at(iso), timeZone: TALLINN, locale })
}

describe('seasonLines', () => {
  test('keeps one set through a UTC day and moves to the next the day after', () => {
    const day = seasonLines('autumn', { now: at('2026-10-06T00:00:00Z') })
    expect(seasonLines('autumn', { now: at('2026-10-06T23:59:59Z') })).toBe(day)
    expect(seasonLines('autumn', { now: at('2026-10-07T00:00:00Z') })).not.toBe(day)
  })

  test("shows each of the season's sets in turn", () => {
    const { lines, alternates } = SEASON_COPY.spring
    const sets = new Set(
      [0, 1, 2, 3].map((d) => seasonLines('spring', { now: at('2026-04-01') + d * DAY })),
    )
    expect(sets).toEqual(new Set([lines, ...alternates]))
  })

  test("adds a date range's set in the user's language", () => {
    const en = firstLines('2026-09-10T12:00:00Z', 4, { timeZone: TALLINN, locale: 'en' })
    const et = firstLines('2026-09-10T12:00:00Z', 4, { timeZone: TALLINN, locale: 'et' })
    expect(en.has(m.tagline_school_en_1)).toBe(true)
    expect(en.has(m.tagline_school_et_1)).toBe(false)
    expect(et.has(m.tagline_school_et_1)).toBe(true)
  })

  test('leaves the ranges out without a zone', () => {
    const sets = firstLines('2026-09-10T12:00:00Z', 4, { locale: 'et' })
    expect(sets.has(m.tagline_school_et_1)).toBe(false)
  })
})

describe('taglineLines', () => {
  test("shows the day's set, with its third line for the cue", () => {
    const now = at('2026-10-06T12:00:00Z')
    expect(tagline('2026-10-06T12:00:00Z')).toBe(
      seasonLines('autumn', { now, timeZone: TALLINN, locale: 'en' }),
    )
  })

  test('stays seasonal without a zone', () => {
    const now = at('2026-09-18T12:00:00Z')
    expect(taglineLines('autumn', { now })).toBe(seasonLines('autumn', { now }))
  })

  test("follows Friday in the user's zone, not in UTC", () => {
    // 00:30 on Friday 18 September in Tallinn, still Thursday in UTC.
    const now = at('2026-09-17T21:30:00Z')
    expect(taglineLines('autumn', { now, timeZone: TALLINN })).toBe(PERIODS.weekEnd)
    expect(taglineLines('autumn', { now, timeZone: 'UTC' })).not.toBe(PERIODS.weekEnd)
  })

  test("counts the month's last three days as its end, ahead of Friday", () => {
    // 01:00 on Monday 28 September in Tallinn, still 27 September in UTC.
    expect(tagline('2026-09-27T22:00:00Z')).toBe(PERIODS.monthEnd)
    expect(tagline('2026-09-30T12:00:00Z')).toBe(PERIODS.monthEnd)
    expect(tagline('2026-10-01T12:00:00Z')).not.toBe(PERIODS.monthEnd)
    expect(tagline('2026-10-30T12:00:00Z')).toBe(PERIODS.monthEnd) // A Friday.
  })

  test("shows a date's set ahead of the month's end", () => {
    expect(tagline('2026-10-31T12:00:00Z')[0]).toBe(m.tagline_halloween_1)
    expect(tagline('2028-02-29T12:00:00Z')[0]).toBe(m.tagline_leap_day_1)
    expect(tagline('2027-01-03T12:00:00Z')[0]).toBe(m.tagline_new_year_1)
  })

  test('shows a date that is in one language only in that language', () => {
    expect(tagline('2026-11-10T12:00:00Z', 'et')[0]).toBe(m.tagline_st_martins_1)
    expect(tagline('2026-11-10T12:00:00Z', 'en')[0]).not.toBe(m.tagline_st_martins_1)
    expect(tagline('2027-06-26T12:00:00Z', 'et')[0]).toBe(m.tagline_midsummer_1)
  })

  test('takes turns between the sets of one date', () => {
    const et = new Set(['2026-12-21', '2026-12-22'].map((d) => tagline(`${d}T12:00:00Z`, 'et')[1]))
    expect(et).toEqual(new Set([m.tagline_santa_2, m.tagline_santa_verse_2]))
    expect(tagline('2026-12-22T12:00:00Z', 'en')[1]).toBe(m.tagline_santa_2)
  })

  test("shows the clock change on the Monday after the EU's switch", () => {
    // The clocks change on Sunday 28 March 2027 and Sunday 25 October 2026.
    expect(tagline('2027-03-29T12:00:00Z')[0]).toBe(m.tagline_clocks_forward_1)
    expect(tagline('2027-03-22T12:00:00Z')[0]).not.toBe(m.tagline_clocks_forward_1)
    expect(tagline('2026-10-26T12:00:00Z')[0]).toBe(m.tagline_clocks_back_1)
    expect(tagline('2026-10-19T12:00:00Z')[0]).not.toBe(m.tagline_clocks_back_1)
  })
})
