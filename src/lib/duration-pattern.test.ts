/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import { fieldsInWords, formatDurationPattern, tokenizePattern } from './duration-pattern'
import { validDurationPattern } from './duration-pattern-settings'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

describe('formatDurationPattern', () => {
  test('pads each field to its run of letters', () => {
    const ms = 2 * HOUR + 5 * MINUTE + 9 * SECOND
    expect(formatDurationPattern(ms, 'H:MM:SS')).toBe('2:05:09')
    expect(formatDurationPattern(ms, 'HH:M:S')).toBe('02:5:9')
    expect(formatDurationPattern(ms, 'HHH')).toBe('002')
    expect(formatDurationPattern(11 * HOUR + 15 * MINUTE + 10 * SECOND, 'HH:MM')).toBe('11:15')
  })

  test('copies other characters as typed', () => {
    expect(formatDurationPattern(2 * HOUR, 'Hh Mm Ss')).toBe('2h 0m 0s')
    expect(formatDurationPattern(11 * HOUR + 15 * MINUTE + 10 * SECOND, 'Hh Mm Ss')).toBe(
      '11h 15m 10s',
    )
  })

  test('keeps the character after a backslash', () => {
    expect(formatDurationPattern(2 * HOUR, 'H\\H')).toBe('2H')
    expect(formatDurationPattern(2 * HOUR, 'H\\')).toBe('2\\')
  })

  test('puts the whole duration in the largest field', () => {
    expect(formatDurationPattern(26 * HOUR + 30 * MINUTE, 'H:MM')).toBe('26:30')
    expect(formatDurationPattern(2 * HOUR + 5 * MINUTE + 9 * SECOND, 'M:SS')).toBe('125:09')
    expect(formatDurationPattern(90 * SECOND, 'S')).toBe('90')
  })

  test('drops partial seconds and negative time', () => {
    expect(formatDurationPattern(59_999, 'H:MM:SS')).toBe('0:00:59')
    expect(formatDurationPattern(-HOUR, 'H:MM:SS')).toBe('0:00:00')
  })
})

describe('validDurationPattern', () => {
  test('needs a field and at most 40 characters', () => {
    expect(validDurationPattern('Hh Mm Ss')).toBe(true)
    expect(validDurationPattern('')).toBe(false)
    expect(validDurationPattern('hms')).toBe(false)
    expect(validDurationPattern('\\H')).toBe(false)
    expect(validDurationPattern('\\HH')).toBe(true)
    expect(validDurationPattern('\\\\H')).toBe(true)
    expect(validDurationPattern(`H${' '.repeat(39)}`)).toBe(true)
    expect(validDurationPattern(`H${' '.repeat(40)}`)).toBe(false)
  })
})

describe('tokenizePattern', () => {
  test('keeps the source of each field, escape, and run of text', () => {
    expect(tokenizePattern('HH:MM \\Hrs')).toEqual([
      { kind: 'field', source: 'HH', field: 'H' },
      { kind: 'text', source: ':' },
      { kind: 'field', source: 'MM', field: 'M' },
      { kind: 'text', source: ' ' },
      { kind: 'escape', source: '\\H', text: 'H' },
      { kind: 'text', source: 'rs' },
    ])
  })
})

describe('fieldsInWords', () => {
  test('finds fields inside a word, but not escaped ones or one-letter units', () => {
    expect(fieldsInWords('Hours: H')).toEqual(['H'])
    expect(fieldsInWords('H Mins')).toEqual(['M'])
    expect(fieldsInWords('HOURS')).toEqual(['H', 'S'])
    expect(fieldsInWords('\\Hours: H')).toEqual([])
    expect(fieldsInWords('Hh Mm Ss')).toEqual([])
    expect(fieldsInWords('H:MM:SS')).toEqual([])
  })
})
