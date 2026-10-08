import { expect, test } from 'bun:test'
import { checkNativeBenchmarkHealth } from './health'

test('requires the native host to confirm that rate limiting is off', () => {
  expect(() => checkNativeBenchmarkHealth({ rate_limit: false })).not.toThrow()
  for (const health of [{ rate_limit: true }, {}, null, { rate_limit: 'off' }]) {
    expect(() => checkNativeBenchmarkHealth(health)).toThrow('RATE_LIMIT=off')
  }
})
