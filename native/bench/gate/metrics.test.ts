import { expect, test } from 'bun:test'
import { compareMetric } from './metrics'

test('CPU has a five percent floor even when the baseline rounds agree', () => {
  expect(compareMetric([100, 100], [105, 105], 'api/timer/cpu_ms').flagged).toBe(false)
  expect(compareMetric([100, 100], [106, 106], 'api/timer/cpu_ms').flagged).toBe(true)
})
test('the two baseline rounds define a wider observed noise band', () => {
  expect(compareMetric([90, 110], [120, 120], 'api/timer/cpu_ms').flagged).toBe(false)
  expect(compareMetric([90, 110], [121, 121], 'api/timer/cpu_ms').flagged).toBe(true)
})
test('sizes have a five percent floor and quantized zero CPU is invalid', () => {
  expect(compareMetric([100, 100], [101, 101], 'static/binary_bytes').flagged).toBe(false)
  expect(compareMetric([100, 100], [90, 90], 'static/binary_bytes').flagged).toBe(false)
  expect(() => compareMetric([0, 0], [1, 1], 'api/timer/cpu_ms')).toThrow('resolution')
})

test('latency and Server-Timing floors apply in their native units', () => {
  for (const [metric, floor] of [
    ['render/week/p95_ms', 10],
    ['render/week/p50_ms', 5],
    ['api/session/session_ms', 5],
    ['api/session/db_ms', 5],
  ] as const) {
    expect(compareMetric([100, 100], [100 + floor, 100 + floor], metric).flagged).toBe(false)
    expect(compareMetric([100, 100], [101 + floor, 101 + floor], metric).flagged).toBe(true)
  }
})
test('RSS uses the larger of five percent and four MiB', () => {
  for (const metric of ['render/week/peak_rss_mb', 'load/peak_rss_mib']) {
    expect(compareMetric([40, 40], [44, 44], metric).flagged).toBe(false)
    expect(compareMetric([40, 40], [45, 45], metric).flagged).toBe(true)
    expect(compareMetric([200, 200], [210, 210], metric).flagged).toBe(false)
    expect(compareMetric([200, 200], [211, 211], metric).flagged).toBe(true)
  }
})
