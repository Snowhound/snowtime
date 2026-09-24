import { describe, expect, test } from 'bun:test'
import { currentSeason, seasonByMonth } from './scene'

describe('seasons', () => {
  test('the month picks the season, with December in winter', () => {
    const seasons = Array.from({ length: 12 }, (_, month) =>
      seasonByMonth(new Date(2026, month, 15)),
    )
    expect(seasons).toEqual([
      'winter',
      'winter',
      'spring',
      'spring',
      'spring',
      'summer',
      'summer',
      'summer',
      'autumn',
      'autumn',
      'autumn',
      'winter',
    ])
  })

  test('a chosen season overrides the month', () => {
    const june = new Date(2026, 5, 1)
    expect(currentSeason('auto', june)).toBe('summer')
    expect(currentSeason('winter', june)).toBe('winter')
  })
})
