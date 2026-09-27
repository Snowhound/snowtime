import { describe, expect, test } from 'bun:test'
import { atLocalTime } from '~/lib/calendar'
import { seasonSets } from '~/lib/scene/seasons'
import { TAGLINES } from './catalogue'
import type { FillSummary } from './fill'
import { taglineLines, taglinePick } from './taglines'

const TALLINN = 'Europe/Tallinn'
const DAY = 86_400_000

function at(iso: string) {
  return Date.parse(iso)
}

function lines(id: string, locale: 'en' | 'et' = 'en') {
  return TAGLINES.find((s) => s.id === id)!.lines[locale]!
}

function tagline(iso: string, locale: 'en' | 'et' = 'en') {
  return taglineLines('autumn', { now: at(iso), timeZone: TALLINN, locale })
}

// The first lines of the taglines shown on `days` days from `from`, at noon UTC.
function firstLines(from: string, days: number, locale: 'en' | 'et', timeZone?: string) {
  return new Set(
    Array.from(
      { length: days },
      (_, d) => taglineLines('autumn', { now: at(from) + d * DAY, timeZone, locale })[0],
    ),
  )
}

describe('TAGLINES', () => {
  test('has unique ids', () => {
    const ids = TAGLINES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('has three lines per language, two for a period', () => {
    for (const set of TAGLINES) {
      const count = 'period' in set.when ? 2 : 3
      for (const [locale, lines] of Object.entries(set.lines)) {
        expect({ id: set.id, locale, lines: lines.length }).toEqual({
          id: set.id,
          locale,
          lines: count,
        })
      }
    }
  })

  test('has no date set on the days of mourning, over years of movable dates', () => {
    const found: string[] = []
    for (let year = 2026; year <= 2050; year++) {
      for (const day of ['06-14', '08-23', '09-22']) {
        const date = `${year}-${day}`
        for (const set of TAGLINES) {
          if ('date' in set.when && set.when.date(date)) found.push(`${date} ${set.id}`)
        }
      }
    }
    expect(found).toEqual([])
  })

  test('has the same placeholders in every language', () => {
    for (const set of TAGLINES) {
      const placeholders = Object.values(set.lines).map((lines) =>
        lines.map((line) => [...line.matchAll(/\{(\w+)\}/g)].map((p) => p[1]).sort()),
      )
      for (const other of placeholders.slice(1)) expect(other).toEqual(placeholders[0])
    }
  })
})

describe('taglineLines', () => {
  test("shows the season's sets and the day's ranges in turn", () => {
    // Monday to Thursday, before the week's end.
    const en = firstLines('2026-09-07T12:00:00Z', 4, 'en', TALLINN)
    const et = firstLines('2026-09-07T12:00:00Z', 4, 'et', TALLINN)
    expect(en.has(lines('school')[0])).toBe(true)
    expect(et.has(lines('school', 'et')[0])).toBe(true)
    for (const set of seasonSets('autumn', 'en')) expect(en.has(set[0])).toBe(true)
  })

  test('leaves the ranges out without a zone', () => {
    const et = firstLines('2026-09-10T12:00:00Z', 4, 'et')
    expect(et.has(lines('school', 'et')[0])).toBe(false)
  })

  test("follows Friday in the user's zone, not in UTC", () => {
    // 00:30 on Friday 18 September in Tallinn, still Thursday in UTC.
    const now = at('2026-09-17T21:30:00Z')
    expect(taglineLines('autumn', { now, timeZone: TALLINN, locale: 'en' })).toEqual(
      lines('week-end'),
    )
    expect(taglineLines('autumn', { now, timeZone: 'UTC', locale: 'en' })).not.toEqual(
      lines('week-end'),
    )
  })

  test("counts the month's last three days as its end, ahead of Friday", () => {
    // 01:00 on Monday 28 September in Tallinn, still 27 September in UTC.
    expect(tagline('2026-09-27T22:00:00Z')).toEqual(lines('month-end'))
    expect(tagline('2026-09-30T12:00:00Z')).toEqual(lines('month-end'))
    expect(tagline('2026-10-01T12:00:00Z')).not.toEqual(lines('month-end'))
    expect(tagline('2026-10-30T12:00:00Z')).toEqual(lines('month-end')) // A Friday.
  })

  test("shows a date's set ahead of the month's end", () => {
    expect(tagline('2026-10-31T12:00:00Z')).toEqual(lines('halloween'))
    expect(tagline('2028-02-29T12:00:00Z')).toEqual(lines('leap-day'))
    expect(tagline('2027-01-03T12:00:00Z')).toEqual(lines('new-year'))
    expect(tagline('2026-12-29T12:00:00Z')).toEqual(lines('between-holidays'))
    expect(tagline('2026-12-31T12:00:00Z')).toEqual(lines('new-years-eve'))
  })

  test("shows a date's set ahead of Friday's", () => {
    expect(tagline('2026-11-13T12:00:00Z')).toEqual(lines('friday-13th'))
    expect(tagline('2027-03-26T12:00:00Z')).toEqual(lines('easter')) // Good Friday.
  })

  test('shows a set only in the languages it has', () => {
    expect(tagline('2026-11-10T12:00:00Z', 'et')).toEqual(lines('st-martins', 'et'))
    expect(TAGLINES.find((s) => s.id === 'st-martins')!.lines.en).toBeUndefined()
    expect(tagline('2027-06-26T12:00:00Z', 'et')).toEqual(lines('midsummer', 'et'))
  })

  test('takes turns between the sets of one date', () => {
    const et = new Set(['2026-12-21', '2026-12-22'].map((d) => tagline(`${d}T12:00:00Z`, 'et')))
    expect(et).toEqual(new Set([lines('santa', 'et'), lines('santa-verse', 'et')]))
    expect(tagline('2026-12-22T12:00:00Z', 'en')).toEqual(lines('santa'))
  })

  test("shows the clock change on the Monday after the EU's switch", () => {
    // The clocks change on Sunday 28 March 2027 and Sunday 25 October 2026.
    expect(tagline('2027-03-29T12:00:00Z')).toEqual(lines('clocks-forward'))
    expect(tagline('2027-03-22T12:00:00Z')).not.toEqual(lines('clocks-forward'))
    expect(tagline('2026-10-26T12:00:00Z')).toEqual(lines('clocks-back'))
    expect(tagline('2026-10-19T12:00:00Z')).not.toEqual(lines('clocks-back'))
  })
})

describe('taglineLines with the fill summary', () => {
  // Tuesday 15 September 2026: no date's set, and not a period's last days.
  const TUESDAY = '2026-09-15'
  const BASE: FillSummary = {
    date: TUESDAY,
    timerStartedAt: null,
    today: 'open',
    lastWorkingDay: { date: '2026-09-14', filled: false },
    lastWeek: false,
    lastMonth: false,
    caughtUp: false,
    emptyDays: 0,
    streak: 0,
  }

  // The lines at `time` in Tallinn on the summary's date, or on `date`.
  function pick(fill: Partial<FillSummary>, time = '12:00', date = fill.date ?? TUESDAY) {
    const now = atLocalTime(date, time, TALLINN)
    return taglinePick('autumn', {
      now,
      timeZone: TALLINN,
      locale: 'en',
      fill: { ...BASE, ...fill },
    })
  }

  function ids(fill: Partial<FillSummary>, time?: string) {
    const { lines: shown } = pick(fill, time)
    return TAGLINES.find((s) => s.lines.en?.[0] === shown[0])?.id ?? 'season'
  }

  test("shows a timer running 8 hours with its hours, ahead of a date's set", () => {
    const started = atLocalTime(TUESDAY, '09:00', TALLINN)
    expect(pick({ timerStartedAt: started }, '17:30').lines[0]).toBe(
      'Your timer has run for 8 hours.',
    )
    expect(pick({ timerStartedAt: started }, '16:30').source).toBe('season')
    // Halloween, a Saturday.
    const halloween = atLocalTime('2026-10-31', '08:00', TALLINN)
    expect(
      pick({ date: '2026-10-31', today: 'off', timerStartedAt: halloween }, '16:00').source,
    ).toBe('timer')
  })

  test('shows a timer running past midnight, and one at the 24-hour cap', () => {
    const lateStart = atLocalTime('2026-09-14', '23:30', TALLINN)
    const night = pick({ timerStartedAt: lateStart }, '00:30')
    expect(night.lines).toEqual([
      'Your timer worked all night.',
      'Did you?',
      'Stop it and fix the hours.',
    ])
    const days = pick({ timerStartedAt: atLocalTime('2026-09-10', '09:00', TALLINN) })
    expect(days.lines[0]).toBe('Your timer gave up after 24 hours.')
  })

  test("shows a date's set, then a period's, ahead of gaps", () => {
    expect(pick({ date: '2026-10-31', today: 'off', emptyDays: 1 }).source).toBe('date')
    expect(pick({ date: '2026-09-18', emptyDays: 1 }).source).toBe('period')
  })

  test('names yesterday, or Friday on a Monday, when 1 or 2 working days are empty', () => {
    expect(ids({ emptyDays: 1 })).toBe('gap-yesterday')
    expect(ids({ emptyDays: 2 })).toBe('gap-yesterday')
    expect(
      ids({
        date: '2026-09-14',
        lastWorkingDay: { date: '2026-09-11', filled: false },
        emptyDays: 1,
      }),
    ).toBe('gap-friday')
    // Wednesday 25 February 2026, after Independence Day: the last working day was Monday.
    expect(
      ids({
        date: '2026-02-25',
        lastWorkingDay: { date: '2026-02-23', filled: false },
        emptyDays: 1,
      }),
    ).toBe('gap-day')
  })

  test('welcomes the user back after 3 empty working days', () => {
    expect(pick({ emptyDays: 3 }).source).toBe('away')
    expect(ids({ emptyDays: 12 })).toBe('welcome-back')
  })

  test('praises today and everything before it filled, with the streak', () => {
    const praised = { today: 'filled', caughtUp: true, streak: 6 } as const
    expect(pick(praised).source).toBe('praise')
    const shown = new Set(
      [0, 1, 2].map((d) => pick(praised, '12:00', `2026-09-1${5 + d}`).lines[0]),
    )
    expect(shown).toContain('6 days in a row.')
    expect(pick({ ...praised, caughtUp: false }).source).toBe('season')
    // A filled Saturday isn't a working day.
    expect(pick({ ...praised, date: '2026-09-19', today: 'off' }).source).toBe('season')
  })

  test('asks for today once the days before are filled', () => {
    const yesterday = { lastWorkingDay: { date: '2026-09-14', filled: true }, streak: 3 }
    expect(pick(yesterday).lines).toEqual([
      "Yesterday's hours are all in.",
      "Lovely. And today's?",
      "Don't let a 3-day streak end here.",
    ])
    const friday = { date: '2026-09-14', lastWorkingDay: { date: '2026-09-11', filled: true } }
    expect(ids(friday)).toBe('filled-friday')
    expect(ids({ lastWeek: true, lastWorkingDay: null })).toBe('last-week')
    expect(ids({ lastMonth: true, lastWorkingDay: null })).toBe('last-month')
    expect(pick({ ...yesterday, today: 'filled' }).source).toBe('season')
  })

  test('ignores a summary from another day, except for the running timer', () => {
    expect(pick({ emptyDays: 1 }, '12:00', '2026-09-16').source).toBe('season')
    const started = atLocalTime(TUESDAY, '09:00', TALLINN)
    expect(pick({ timerStartedAt: started }, '12:00', '2026-09-16').source).toBe('timer')
  })

  test('stays seasonal without a zone, as on the sign-in page', () => {
    const now = atLocalTime(TUESDAY, '12:00', TALLINN)
    const fill = { ...BASE, emptyDays: 1 }
    expect(taglinePick('autumn', { now, locale: 'en', fill }).source).toBe('season')
  })
})
