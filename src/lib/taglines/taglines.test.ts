import { describe, expect, test } from 'bun:test'
import { seasonSets } from '~/lib/scene/seasons'
import { TAGLINES } from './catalogue'
import { taglineLines } from './taglines'

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
    expect(taglineLines('autumn', { now, timeZone: TALLINN, locale: 'en' })).toBe(lines('week-end'))
    expect(taglineLines('autumn', { now, timeZone: 'UTC', locale: 'en' })).not.toBe(
      lines('week-end'),
    )
  })

  test("counts the month's last three days as its end, ahead of Friday", () => {
    // 01:00 on Monday 28 September in Tallinn, still 27 September in UTC.
    expect(tagline('2026-09-27T22:00:00Z')).toBe(lines('month-end'))
    expect(tagline('2026-09-30T12:00:00Z')).toBe(lines('month-end'))
    expect(tagline('2026-10-01T12:00:00Z')).not.toBe(lines('month-end'))
    expect(tagline('2026-10-30T12:00:00Z')).toBe(lines('month-end')) // A Friday.
  })

  test("shows a date's set ahead of the month's end", () => {
    expect(tagline('2026-10-31T12:00:00Z')).toBe(lines('halloween'))
    expect(tagline('2028-02-29T12:00:00Z')).toBe(lines('leap-day'))
    expect(tagline('2027-01-03T12:00:00Z')).toBe(lines('new-year'))
  })

  test('shows a set only in the languages it has', () => {
    expect(tagline('2026-11-10T12:00:00Z', 'et')).toBe(lines('st-martins', 'et'))
    expect(TAGLINES.find((s) => s.id === 'st-martins')!.lines.en).toBeUndefined()
    expect(tagline('2027-06-26T12:00:00Z', 'et')).toBe(lines('midsummer', 'et'))
  })

  test('takes turns between the sets of one date', () => {
    const et = new Set(['2026-12-21', '2026-12-22'].map((d) => tagline(`${d}T12:00:00Z`, 'et')))
    expect(et).toEqual(new Set([lines('santa', 'et'), lines('santa-verse', 'et')]))
    expect(tagline('2026-12-22T12:00:00Z', 'en')).toBe(lines('santa'))
  })

  test("shows the clock change on the Monday after the EU's switch", () => {
    // The clocks change on Sunday 28 March 2027 and Sunday 25 October 2026.
    expect(tagline('2027-03-29T12:00:00Z')).toBe(lines('clocks-forward'))
    expect(tagline('2027-03-22T12:00:00Z')).not.toBe(lines('clocks-forward'))
    expect(tagline('2026-10-26T12:00:00Z')).toBe(lines('clocks-back'))
    expect(tagline('2026-10-19T12:00:00Z')).not.toBe(lines('clocks-back'))
  })
})
