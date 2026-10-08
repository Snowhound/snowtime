import { expect, test } from 'bun:test'
import { compareMetric } from './metrics'

test('CPU has a five percent floor even when the baseline rounds agree', () => {
  expect(compareMetric([100, 100], [105, 105], true).flagged).toBe(false)
  expect(compareMetric([100, 100], [106, 106], true).flagged).toBe(true)
})
test('the two baseline rounds define a wider observed noise band', () => {
  expect(compareMetric([90, 110], [120, 120], true).flagged).toBe(false)
  expect(compareMetric([90, 110], [121, 121], true).flagged).toBe(true)
})
test('sizes have no noise floor and quantized zero CPU is invalid', () => {
  expect(compareMetric([100, 100], [101, 101], false).flagged).toBe(true)
  expect(compareMetric([100, 100], [90, 90], false).flagged).toBe(false)
  expect(() => compareMetric([0, 0], [1, 1], true)).toThrow('resolution')
})
