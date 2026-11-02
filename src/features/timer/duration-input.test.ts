import { describe, expect, test } from 'bun:test'
import { formatDurationInput, parseDuration } from './duration-input'

const MINUTE = 60_000

describe('parseDuration', () => {
  test.each([
    ['1:30', 90],
    ['0:45', 45],
    ['24:00', 24 * 60],
    ['1h 30m', 90],
    ['1h30', 90],
    ['1h30m', 90],
    ['2 hours 5 minutes', 125],
    ['1.5h', 90],
    ['90m', 90],
    ['90 min', 90],
    ['90 mins', 90],
    ['1.5', 90],
    ['1,5', 90],
    ['2', 120],
    ['0.25', 15],
    ['1 t 30 min', 90],
    ['1t30', 90],
    ['2 tundi', 120],
    ['45 minutit', 45],
    ['  1H 30M  ', 90],
  ])('%p is %p minutes', (text, minutes) => {
    expect(parseDuration(text)).toEqual({ ms: minutes * MINUTE })
  })

  test('H:MM:SS keeps the seconds', () => {
    expect(parseDuration('1:30:15')).toEqual({ ms: (5400 + 15) * 1000 })
  })

  test('the other forms round to the minute', () => {
    expect(parseDuration('1.01')).toEqual({ ms: 61 * MINUTE })
  })

  test.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'format'],
    ['1:75', 'format'],
    ['1:30:1', 'format'],
    ['-1', 'format'],
    ['1h 30x', 'format'],
    ['0', 'too_short'],
    ['0:00:30', 'too_short'],
    ['25h', 'too_long'],
    ['24:01', 'too_long'],
    ['24.5', 'too_long'],
  ])('%p is refused as %p', (text, error) => {
    expect(parseDuration(text)).toMatchObject({ error })
  })

  test('a bare number over 24 hours suggests minutes', () => {
    expect(parseDuration('90')).toEqual({ error: 'bare_hours', text: '90' })
  })
})

describe('formatDurationInput', () => {
  test('reads as hours and minutes', () => {
    expect(formatDurationInput(90 * MINUTE)).toBe('1:30')
    expect(formatDurationInput(5 * MINUTE)).toBe('0:05')
    expect(formatDurationInput(24 * 60 * MINUTE)).toBe('24:00')
  })
})
