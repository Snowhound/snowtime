/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import {
  addMonths,
  dateFormat,
  formatDateInput,
  formatTimeInput,
  monthWeeks,
  parseDateInput,
  parseTimeInput,
  shiftTime,
  uses12Hours,
} from './date-input'

const TODAY = '2026-09-25'

describe('dates', () => {
  test('follow the locale order', () => {
    expect(dateFormat('en').order).toEqual(['month', 'day', 'year'])
    expect(dateFormat('et')).toEqual({ order: ['day', 'month', 'year'], separator: '.' })
    expect(formatDateInput('2026-09-05', 'en')).toBe('09/05/2026')
    expect(formatDateInput('2026-09-05', 'et')).toBe('05.09.2026')
  })

  test('read back what they show', () => {
    for (const locale of ['en', 'et']) {
      expect(parseDateInput(formatDateInput('2026-02-03', locale), locale, TODAY)).toBe(
        '2026-02-03',
      )
    }
  })

  test('accept short forms and any separator', () => {
    expect(parseDateInput('5.9.2026', 'et', TODAY)).toBe('2026-09-05')
    expect(parseDateInput('5/9/26', 'et', TODAY)).toBe('2026-09-05')
    expect(parseDateInput('5.9', 'et', TODAY)).toBe('2026-09-05')
    expect(parseDateInput('9/5', 'en', TODAY)).toBe('2026-09-05')
    expect(parseDateInput('05092026', 'et', TODAY)).toBe('2026-09-05')
    expect(parseDateInput('090526', 'en', TODAY)).toBe('2026-09-05')
    expect(parseDateInput('2026-09-05', 'en', TODAY)).toBe('2026-09-05')
    expect(parseDateInput(' 2026-9-5 ', 'et', TODAY)).toBe('2026-09-05')
  })

  test('reject what is not a date', () => {
    for (const text of ['', 'x', '31.2.2026', '1.13.2026', '1.2.202', '5', '1.2.3.4', '123.4']) {
      expect(parseDateInput(text, 'et', TODAY)).toBeNull()
    }
  })
})

describe('times', () => {
  test('follow the locale hour cycle', () => {
    expect(uses12Hours('en')).toBe(true)
    expect(uses12Hours('et')).toBe(false)
    expect(formatTimeInput('21:05', 'et')).toBe('21:05')
    expect(formatTimeInput('21:05', 'en').replace(/\s/g, ' ')).toBe('09:05 PM')
    expect(formatTimeInput('00:30', 'en').replace(/\s/g, ' ')).toBe('12:30 AM')
  })

  test('read typed forms', () => {
    const cases: Record<string, string> = {
      '9': '09:00',
      '930': '09:30',
      '0930': '09:30',
      '9:30': '09:30',
      '9.30': '09:30',
      '9,30': '09:30',
      '9 30': '09:30',
      '21:05': '21:05',
      '9:30pm': '21:30',
      '9.30 p.m.': '21:30',
      '12 am': '00:00',
      '12:15 PM': '12:15',
      '9a': '09:00',
    }
    for (const [text, time] of Object.entries(cases)) expect(parseTimeInput(text)).toBe(time)
    expect(parseTimeInput(formatTimeInput('21:05', 'en'))).toBe('21:05')
  })

  test('reject what is not a time', () => {
    for (const text of ['', '24', '9:60', '13pm', '0 am', '12345', 'noon', '9:3']) {
      expect(parseTimeInput(text)).toBeNull()
    }
  })

  test('shift around midnight', () => {
    expect(shiftTime('23:59', 1)).toBe('00:00')
    expect(shiftTime('00:10', -15)).toBe('23:55')
    expect(shiftTime('09:00', 60)).toBe('10:00')
  })
})

describe('calendar', () => {
  test('lays a month out in whole weeks from the week start', () => {
    const monday = monthWeeks('2026-09-25', 'mon')
    expect(monday[0][0]).toBe('2026-08-31')
    expect(monday.at(-1)!.at(-1)).toBe('2026-10-04')
    expect(monday).toHaveLength(5)
    const sunday = monthWeeks('2026-02-10', 'sun')
    expect(sunday[0][0]).toBe('2026-02-01')
    expect(sunday).toHaveLength(4)
  })

  test('moves by months, keeping the day where it can', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
    expect(addMonths('2026-12-01', 13)).toBe('2028-01-01')
  })
})
