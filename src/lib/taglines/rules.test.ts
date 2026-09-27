import { describe, expect, test } from 'bun:test'
import { dayOfYear, easter, fridayThe13th, fromEaster, monthStart } from './rules'

describe('easter', () => {
  test('matches known dates, including the earliest and latest possible', () => {
    expect(easter(2024)).toBe('2024-03-31')
    expect(easter(2025)).toBe('2025-04-20')
    expect(easter(2026)).toBe('2026-04-05')
    expect(easter(2027)).toBe('2027-03-28')
    expect(easter(2028)).toBe('2028-04-16')
    expect(easter(2038)).toBe('2038-04-25')
    expect(easter(2285)).toBe('2285-03-22')
    expect(easter(2000)).toBe('2000-04-23')
  })

  test('puts Shrove Tuesday 47 days before', () => {
    const shroveTuesday = fromEaster(-47)
    expect(shroveTuesday('2026-02-17')).toBe(true)
    expect(shroveTuesday('2027-02-09')).toBe(true)
    expect(shroveTuesday('2026-02-16')).toBe(false)
  })
})

test('monthStart is the first weekday of every month but January', () => {
  expect(monthStart('2026-10-01')).toBe(true) // A Thursday.
  expect(monthStart('2026-11-02')).toBe(true) // 1 November is a Sunday.
  expect(monthStart('2026-08-03')).toBe(true) // 1 August is a Saturday.
  expect(monthStart('2026-08-04')).toBe(false)
  expect(monthStart('2026-11-01')).toBe(false)
  expect(monthStart('2026-01-01')).toBe(false)
})

test('fridayThe13th and dayOfYear', () => {
  expect(fridayThe13th('2026-11-13')).toBe(true)
  expect(fridayThe13th('2026-10-13')).toBe(false)
  expect(dayOfYear(256)('2026-09-13')).toBe(true)
  expect(dayOfYear(256)('2028-09-12')).toBe(true)
  expect(dayOfYear(256)('2028-09-13')).toBe(false)
})
