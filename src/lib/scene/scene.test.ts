import { describe, expect, test } from 'bun:test'
import { currentSeason, photoWidth, seasonByMonth } from './scene'

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

describe('photoWidth', () => {
  test('the large file only where the image covers more than 2400 device pixels', () => {
    expect(photoWidth({ width: 1440, height: 900, dpr: 1 })).toBe(1920)
    expect(photoWidth({ width: 1440, height: 900, dpr: 2 })).toBe(3840)
    expect(photoWidth({ width: 850, height: 900, dpr: 1 })).toBe(1920)
    expect(photoWidth({ width: 850, height: 900, dpr: 2 })).toBe(3840)
    expect(photoWidth({ width: 2560, height: 1440, dpr: 1 })).toBe(3840)
  })

  test('narrow screens get the small file at any pixel ratio', () => {
    expect(photoWidth({ width: 390, height: 844, dpr: 3 })).toBe(1920)
    expect(photoWidth({ width: 767, height: 1024, dpr: 2 })).toBe(1920)
  })

  test('the pixel ratio counts up to 2', () => {
    expect(photoWidth({ width: 1024, height: 600, dpr: 3 })).toBe(
      photoWidth({ width: 1024, height: 600, dpr: 2 }),
    )
  })
})
