import { describe, expect, test } from 'bun:test'
import { type IsoDate, atLocalTime, datesBetween } from '~/lib/calendar'
import { fillSummary } from './fill'

const TALLINN = 'Europe/Tallinn'
const HOUR = 3_600_000

// An entry from 09:00 on the date, in Tallinn.
function entry(date: IsoDate, hours = 8) {
  const startedAt = atLocalTime(date, '09:00', TALLINN)
  return { startedAt: new Date(startedAt), stoppedAt: new Date(startedAt + hours * HOUR) }
}

// A full day on each weekday from `from` up to but not including `to`.
function weekdays(from: IsoDate, to: IsoDate) {
  return datesBetween(from, to)
    .filter((date) => ![0, 6].includes(new Date(date).getUTCDay()))
    .map((date) => entry(date))
}

// At noon in Tallinn on the date, for an account from the start of 2026.
function summary(
  date: IsoDate,
  entries: { startedAt: Date; stoppedAt: Date | null }[],
  options: { region?: string; since?: IsoDate; time?: string } = {},
) {
  return fillSummary(entries, {
    now: atLocalTime(date, options.time ?? '12:00', TALLINN),
    timeZone: TALLINN,
    weekStart: 'mon',
    region: options.region ?? 'EE',
    since: options.since ?? '2026-01-01',
  })
}

describe('fillSummary', () => {
  // Wednesday 23 September 2026, with August and September filled up to the 22nd.
  const filled = weekdays('2026-08-01', '2026-09-23')

  test('with every working day filled, counts the streak and last week and month', () => {
    expect(summary('2026-09-23', filled)).toEqual({
      date: '2026-09-23',
      timerStartedAt: null,
      today: 'open',
      lastWorkingDay: { date: '2026-09-22', filled: true },
      lastWeek: true,
      lastMonth: true,
      caughtUp: true,
      emptyDays: 0,
      // 20 working days in August (the 20th is a holiday), and 16 in September before the 23rd.
      streak: 36,
    })
  })

  test('fills a working day at 6 hours, and counts today once it is', () => {
    const fill = summary('2026-09-23', [...filled, entry('2026-09-23', 6)], { time: '16:00' })
    expect(fill).toMatchObject({ today: 'filled', streak: 37 })
    expect(
      summary('2026-09-23', [...filled, entry('2026-09-23', 5.9)], { time: '16:00' }).today,
    ).toBe('open')
  })

  test("fills Estonia's shortened working days at 3 hours", () => {
    // Monday 23 February 2026, the day before Independence Day.
    const shortDay = [...weekdays('2026-01-01', '2026-02-23'), entry('2026-02-23', 3)]
    expect(summary('2026-02-25', shortDay).lastWorkingDay).toEqual({
      date: '2026-02-23',
      filled: true,
    })
    expect(summary('2026-02-25', shortDay, { region: 'US' }).lastWorkingDay).toEqual({
      date: '2026-02-24',
      filled: false,
    })
    const tooShort = [...weekdays('2026-01-01', '2026-02-23'), entry('2026-02-23', 2.9)]
    expect(summary('2026-02-25', tooShort).lastWorkingDay?.filled).toBe(false)
  })

  test('counts a running timer up to now, and notes when it started', () => {
    const running = {
      startedAt: new Date(atLocalTime('2026-09-23', '08:00', TALLINN)),
      stoppedAt: null,
    }
    const fill = summary('2026-09-23', [...filled, running], { time: '15:00' })
    expect(fill).toMatchObject({ today: 'filled', timerStartedAt: running.startedAt.getTime() })
  })

  test('counts an empty working day as a gap, and a short one only as not filled', () => {
    const withoutMonday = filled.filter((e) => !e.startedAt.toISOString().startsWith('2026-09-21'))
    expect(summary('2026-09-22', withoutMonday)).toMatchObject({
      lastWorkingDay: { date: '2026-09-21', filled: false },
      emptyDays: 1,
      streak: 0,
      caughtUp: false,
    })
    expect(summary('2026-09-22', [...withoutMonday, entry('2026-09-21', 2)])).toMatchObject({
      lastWorkingDay: { date: '2026-09-21', filled: false },
      emptyDays: 0,
    })
  })

  test('counts three empty working days in a row as an absence, across a weekend', () => {
    const toThursday = weekdays('2026-08-01', '2026-09-18')
    expect(summary('2026-09-23', toThursday)).toMatchObject({
      lastWorkingDay: { date: '2026-09-22', filled: false },
      emptyDays: 3,
      lastWeek: false,
    })
  })

  test("doesn't count weekends or Estonia's public holidays as gaps", () => {
    // Tuesday 24 February 2026 is Independence Day.
    const beforeHoliday = weekdays('2026-01-01', '2026-02-24')
    expect(summary('2026-02-25', beforeHoliday)).toMatchObject({
      lastWorkingDay: { date: '2026-02-23', filled: true },
      emptyDays: 0,
      caughtUp: true,
    })
    // Other regions count 24 February as a working day.
    expect(summary('2026-02-25', beforeHoliday, { region: 'other' }).emptyDays).toBe(1)
    // Saturday 26 September.
    expect(summary('2026-09-26', weekdays('2026-08-01', '2026-09-26'))).toMatchObject({
      today: 'off',
      lastWorkingDay: { date: '2026-09-25', filled: true },
      emptyDays: 0,
    })
  })

  test("follows the user's region: the US's Labor Day isn't a gap there", () => {
    // Monday 7 September 2026 is Labor Day.
    const withoutLaborDay = filled.filter(
      (e) => !e.startedAt.toISOString().startsWith('2026-09-07'),
    )
    expect(summary('2026-09-08', withoutLaborDay, { region: 'US' })).toMatchObject({
      lastWorkingDay: { date: '2026-09-04', filled: true },
      emptyDays: 0,
    })
    expect(summary('2026-09-08', withoutLaborDay, { region: 'EE' }).emptyDays).toBe(1)
  })

  test('expects nothing before the account was created', () => {
    expect(summary('2026-09-23', [], { since: '2026-09-23' })).toMatchObject({
      today: 'open',
      lastWorkingDay: null,
      lastWeek: null,
      lastMonth: null,
      caughtUp: true,
      emptyDays: 0,
      streak: 0,
    })
    expect(summary('2026-09-23', [entry('2026-09-21')], { since: '2026-09-21' })).toMatchObject({
      lastWorkingDay: { date: '2026-09-22', filled: false },
      emptyDays: 1,
      lastWeek: null,
    })
  })
})
