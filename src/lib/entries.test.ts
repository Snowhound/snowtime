import { describe, expect, test } from 'bun:test'
import { groupByDay, readEntryTimes, recentRange } from './entries'

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
