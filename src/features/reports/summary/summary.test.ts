import { describe, expect, test } from 'bun:test'
import type { Row } from '../rows'
import { chartScale, chartSeries } from './chart-series'
import { summaryStats } from './stats'

const HOUR = 3_600_000

function project(i: number, total: number, color: string | null = '#3b82b8'): Row {
  return { key: `p${i}`, name: `Project ${i}`, color, total, perBucket: [total - HOUR, HOUR] }
}

describe('chartSeries', () => {
  test('keeps up to eight projects, in project colors', () => {
    const rows = [project(1, 5 * HOUR), project(2, 3 * HOUR, '#d9703f'), project(3, 2 * HOUR, null)]
    const series = chartSeries(rows)
    expect(series.map((s) => [s.key, s.color])).toEqual([
      ['p1', 'var(--series-1)'],
      ['p2', 'var(--series-2)'],
      ['p3', 'var(--muted-foreground)'],
    ])
    expect(
      chartSeries(Array.from({ length: 8 }, (_, i) => project(i, HOUR * (9 - i)))),
    ).toHaveLength(8)
  })

  test('folds the projects past seven into "Other"', () => {
    const rows = Array.from({ length: 10 }, (_, i) => project(i, HOUR * (11 - i)))
    const series = chartSeries(rows)
    expect(series.map((s) => s.key)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'other'])
    const other = series.at(-1)!
    expect(other.name).toBe('Other (3 projects)')
    // Projects 7, 8, and 9: 4, 3, and 2 hours, one of each in the second bucket.
    expect(other.total).toBe(9 * HOUR)
    expect(other.perBucket).toEqual([6 * HOUR, 3 * HOUR])
    const total = rows.reduce((sum, r) => sum + r.total, 0)
    expect(series.reduce((sum, s) => sum + s.total, 0)).toBe(total)
  })
})

describe('chartScale', () => {
  test('steps in round hours, at most four of them', () => {
    expect(chartScale(0)).toEqual({ max: HOUR, ticks: [0, 0.5, 1].map((h) => h * HOUR) })
    expect(chartScale(7.5 * HOUR)).toEqual({
      max: 8 * HOUR,
      ticks: [0, 2, 4, 6, 8].map((h) => h * HOUR),
    })
    expect(chartScale(9 * HOUR).max).toBe(12 * HOUR)
    expect(chartScale(130 * HOUR).max).toBe(160 * HOUR)
  })
})

describe('summaryStats', () => {
  const week = { from: '2026-09-21', to: '2026-09-28' }

  test('averages over the days with time, out of the days so far', () => {
    expect(summaryStats({ total: 6 * HOUR, trackedDays: 3 }, week, '2026-09-24')).toEqual({
      total: 6 * HOUR,
      average: 2 * HOUR,
      tracked: 3,
      days: 4,
    })
    // A past range counts all its days.
    expect(summaryStats({ total: 0, trackedDays: 0 }, week, '2026-10-05')).toMatchObject({
      average: 0,
      days: 7,
    })
  })

  test('counts time tracked ahead of today', () => {
    expect(summaryStats({ total: HOUR, trackedDays: 1 }, week, '2026-09-20').days).toBe(1)
  })
})
