/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import { formatHours } from './format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

describe('formatHours', () => {
  test('shows hours and minutes on a clock, rounded to the minute', () => {
    expect(formatHours(11 * HOUR + 10 * MINUTE)).toBe('11:10')
    expect(formatHours(5 * MINUTE + 29_000)).toBe('0:05')
    expect(formatHours(-MINUTE)).toBe('0:00')
  })

  test('with units, leaves out a zero part', () => {
    expect(formatHours(11 * HOUR + 10 * MINUTE, 'units')).toBe('11h\u00a010m')
    expect(formatHours(2 * HOUR, 'units')).toBe('2h')
    expect(formatHours(45 * MINUTE, 'units')).toBe('45m')
    expect(formatHours(0, 'units')).toBe('0m')
  })
})
