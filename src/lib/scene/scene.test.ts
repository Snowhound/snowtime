import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { IMAGE_IDS } from './images'
import {
  calendarImage,
  imageFor,
  imageSeason,
  PHOTO_THUMB,
  photoUrl,
  photoWidth,
  seasonByMonth,
  shownSeason,
  thumbUrl,
} from './scene'
import { EFFECTS, HORIZONS, IMAGE_WEATHER, PRESETS, weatherFor } from './weather'

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

  test('a zone moves the month at its own midnight', () => {
    const utcEndOfFebruary = new Date('2026-02-28T23:30:00Z')
    expect(seasonByMonth(utcEndOfFebruary, 'UTC')).toBe('winter')
    expect(seasonByMonth(utcEndOfFebruary, 'Europe/Tallinn')).toBe('spring')
  })
})

describe('collections', () => {
  const june = new Date(2026, 5, 15)

  test('the calendar picks the season or the month', () => {
    expect(calendarImage('mountains', june)).toBe('summer')
    expect(calendarImage('coast', june)).toBe('coast-june')
    expect(calendarImage('countryside', new Date(2026, 0, 1))).toBe('land-january')
  })

  test('a pin overrides the calendar, and a pin from another collection is ignored', () => {
    expect(imageFor({ sceneCollection: 'coast', scenePin: null }, june)).toBe('coast-june')
    expect(imageFor({ sceneCollection: 'coast', scenePin: 'coast-march' }, june)).toBe(
      'coast-march',
    )
    expect(imageFor({ sceneCollection: 'coast', scenePin: 'land-march' }, june)).toBe('coast-june')
  })

  test("the tagline follows the pinned image's season, or the calendar's", () => {
    expect(shownSeason({ sceneCollection: 'countryside', scenePin: null }, june)).toBe('summer')
    expect(shownSeason({ sceneCollection: 'mountains', scenePin: 'winter' }, june)).toBe('winter')
    expect(shownSeason({ sceneCollection: 'coast', scenePin: 'coast-december' }, june)).toBe(
      'winter',
    )
    expect(imageSeason('land-november')).toBe('autumn')
  })

  test("each image's files are in its collection's folder", () => {
    expect(photoUrl('winter', 'dark', 3840)).toBe('/backgrounds/mountains/winter-dark-01-3840.avif')
    expect(thumbUrl('winter', 'light')).toBe('/backgrounds/mountains/winter-light-01-400.avif')
    expect(photoUrl('coast-january', 'dark', 3840)).toBe(
      '/backgrounds/coast/coast-january-dark-01-3840.avif',
    )
    expect(thumbUrl('land-may', 'light')).toBe(
      '/backgrounds/countryside/land-may-light-02-400.avif',
    )
  })

  test('a replaced image has a new version in its file name', () => {
    expect(photoUrl('coast-march', 'dark', 3840)).toBe(
      '/backgrounds/coast/coast-march-dark-02-3840.avif',
    )
    expect(photoUrl('land-august', 'light', 1920)).toBe(
      '/backgrounds/countryside/land-august-light-01-1920.avif',
    )
  })

  test('every image has its files in public/backgrounds/', () => {
    for (const id of IMAGE_IDS) {
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [PHOTO_THUMB, 1920, 3840]) {
          expect(existsSync(`public${photoUrl(id, theme, width)}`)).toBe(true)
        }
      }
    }
  })
})

describe('weather', () => {
  const THEMES = ['light', 'dark'] as const

  test('every image has weather for both themes, from a known preset', () => {
    expect(Object.keys(IMAGE_WEATHER).sort()).toEqual([...IMAGE_IDS].sort())
    for (const id of IMAGE_IDS) {
      for (const theme of THEMES) {
        expect(Object.keys(PRESETS)).toContain(IMAGE_WEATHER[id][theme].preset)
      }
    }
  })

  test("each preset's effect exists and its hint has messages in both languages", () => {
    for (const locale of ['en', 'et']) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8'))
      for (const preset of Object.values(PRESETS)) {
        expect(messages[`scene_effect_${preset.hint}`]).toBeString()
      }
    }
    for (const preset of Object.values(PRESETS)) {
      if (preset.effect !== null) expect(EFFECTS[preset.effect]).toBeDefined()
    }
  })

  test("an image's fields override its preset's, and it takes its horizon", () => {
    const weather = weatherFor('coast-february', 'dark')
    expect(weather).toMatchObject({ effect: 'snow', hint: 'blowing', fps: 60, wind: -0.24 })
    expect(weather.shear).toBe(PRESETS.blowing.shear)
    expect(weather.horizon).toBe(HORIZONS['coast-february'])
  })

  test('horizons, bands, and zones lie within the image', () => {
    for (const horizon of Object.values(HORIZONS)) {
      expect(horizon).toBeGreaterThan(0)
      expect(horizon).toBeLessThan(1)
    }
    for (const id of IMAGE_IDS) {
      for (const theme of THEMES) {
        const { band, zones } = weatherFor(id, theme)
        if (band) {
          const [top, bottom] = band
          expect(top).toBeGreaterThanOrEqual(0)
          expect(top).toBeLessThan(bottom)
          // A spray band may reach past the foot, so the droplets fade out off-screen.
          expect(bottom).toBeLessThanOrEqual(1.1)
        }
        expect(zones?.length ?? 0).toBeLessThanOrEqual(3)
        for (const [left, top, right, bottom, gain = 1] of zones ?? []) {
          for (const f of [left, top, right, bottom]) {
            expect(f).toBeGreaterThanOrEqual(0)
            expect(f).toBeLessThanOrEqual(1)
          }
          expect(left).toBeLessThan(right)
          expect(top).toBeLessThan(bottom)
          expect(gain).toBeGreaterThan(0)
        }
      }
    }
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
