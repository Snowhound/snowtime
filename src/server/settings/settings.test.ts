/// <reference types="bun" />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import * as v from 'valibot'
import type { Database } from '~/db'
import { user } from '~/db/schema'
import { seedIds } from '~/db/seed'
import { as, createSeededDatabase } from '../testing'
import { GetSettingsInput, UpdateSettingsInput } from './settings.schemas'
import { getSettings, updateSettings } from './settings.server'

const { users: U } = seedIds

let db: Database
let cleanup: () => void

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase(new Date('2026-09-23T12:00:00Z')))
})

afterAll(() => cleanup())

// What a new row holds besides the zone.
const DEFAULTS = {
  weekStart: 'mon',
  locale: 'en',
  theme: 'system',
  timerLayout: 'bar',
  showSummary: true,
  compactRows: false,
  wideTimer: false,
  timerView: 'list',
  calendarWeekend: false,
  appIcon: '02',
  sceneCollection: 'mountains',
  scenePin: null,
  sceneBackground: true,
  sceneStrength: 'dimmed',
  surfaces: 'glass',
  sceneWeather: true,
  sceneIntro: true,
  sceneTagline: true,
  durationFormat: 'clock',
  dateFormat: 'dmy',
  timeFormat: '24h',
  country: null,
} as const

// A signed-up user who has not loaded the app yet, so has no settings row.
async function newUser() {
  const id = uuidv7()
  const now = new Date()
  await db
    .insert(user)
    .values({ id, name: 'New', email: `${id}@example.com`, createdAt: now, updatedAt: now })
  return id
}

describe('getSettings', () => {
  test("the first call creates the settings with the browser's zone and locale; later calls keep them", async () => {
    const userId = await newUser()
    const first = await as({ userId }, () =>
      getSettings(db, userId, { timeZone: 'Asia/Tokyo', locale: 'et' }),
    )
    expect(first).toEqual({ ...DEFAULTS, timeZone: 'Asia/Tokyo', locale: 'et' })
    const again = await as({ userId }, () =>
      getSettings(db, userId, { timeZone: 'Europe/Paris', locale: 'en' }),
    )
    expect(again).toEqual(first)
  })

  test('seeded users get their own settings', async () => {
    const settings = await as({ userId: U.engLead }, () =>
      getSettings(db, U.engLead, { timeZone: 'UTC', locale: 'et' }),
    )
    expect(settings).toEqual({ ...DEFAULTS, timeZone: 'America/New_York' })
  })
})

describe('updateSettings', () => {
  test("changes only the fields present, and only the user's own row", async () => {
    const updated = await as({ userId: U.member }, () =>
      updateSettings(db, U.member, { weekStart: 'sun' }),
    )
    expect(updated).toEqual({ ...DEFAULTS, timeZone: 'Europe/Tallinn', weekStart: 'sun' })
    const zone = await as({ userId: U.member }, () =>
      updateSettings(db, U.member, { timeZone: 'America/Los_Angeles', locale: 'et' }),
    )
    expect(zone).toEqual({
      ...DEFAULTS,
      timeZone: 'America/Los_Angeles',
      weekStart: 'sun',
      locale: 'et',
    })
    const other = await as({ userId: U.lead }, () =>
      getSettings(db, U.lead, { timeZone: 'UTC', locale: 'en' }),
    )
    expect(other).toEqual({ ...DEFAULTS, timeZone: 'Europe/Tallinn' })
  })

  test('view settings save one field at a time, as the UI auto-saves them', async () => {
    function save(patch: UpdateSettingsInput) {
      return as({ userId: U.loner }, () => updateSettings(db, U.loner, patch))
    }
    await save({ theme: 'dark' })
    await save({ timerLayout: 'table' })
    await save({ showSummary: false })
    await save({ appIcon: '10' })
    await save({ sceneCollection: 'coast', scenePin: 'coast-march' })
    await save({ sceneBackground: false })
    await save({ sceneStrength: 'full' })
    await save({ surfaces: 'solid' })
    await save({ sceneWeather: false })
    const last = await save({ sceneIntro: false })
    expect(last).toEqual({
      ...DEFAULTS,
      timeZone: 'Europe/London',
      theme: 'dark',
      timerLayout: 'table',
      showSummary: false,
      appIcon: '10',
      sceneCollection: 'coast',
      scenePin: 'coast-march',
      sceneBackground: false,
      sceneStrength: 'full',
      surfaces: 'solid',
      sceneWeather: false,
      sceneIntro: false,
    })
    expect(await save({})).toEqual(last)
  })

  test('the country saves, and null brings back the time zone guess', async () => {
    const userId = await newUser()
    await as({ userId }, () =>
      getSettings(db, userId, { timeZone: 'Europe/Tallinn', locale: 'en' }),
    )
    const set = await as({ userId }, () => updateSettings(db, userId, { country: 'US' }))
    expect(set.country).toBe('US')
    const cleared = await as({ userId }, () => updateSettings(db, userId, { country: null }))
    expect(cleared.country).toBeNull()
  })

  test('choosing a collection clears the pin, and a pin must be in the collection', async () => {
    const userId = await newUser()
    await as({ userId }, () =>
      getSettings(db, userId, { timeZone: 'Europe/Tallinn', locale: 'en' }),
    )
    function save(patch: UpdateSettingsInput) {
      return as({ userId }, () => updateSettings(db, userId, patch))
    }
    expect(await save({ scenePin: 'autumn' })).toMatchObject({
      sceneCollection: 'mountains',
      scenePin: 'autumn',
    })
    expect(await save({ sceneCollection: 'countryside' })).toMatchObject({
      sceneCollection: 'countryside',
      scenePin: null,
    })
    expect(await save({ scenePin: 'land-june' })).toMatchObject({ scenePin: 'land-june' })
    await expect(save({ scenePin: 'coast-june' })).rejects.toMatchObject({
      code: 'INVALID',
      key: 'scene_pin_not_in_collection',
    })
    await expect(
      save({ sceneCollection: 'mountains', scenePin: 'land-june' }),
    ).rejects.toMatchObject({ code: 'INVALID' })
    expect(await save({ sceneCollection: 'coast', scenePin: 'coast-june' })).toMatchObject({
      sceneCollection: 'coast',
      scenePin: 'coast-june',
    })
  })

  test('a user without settings is told to load them first', async () => {
    const userId = await newUser()
    await expect(
      as({ userId }, () => updateSettings(db, userId, { weekStart: 'sun' })),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('settings input', () => {
  test('time zones must be IANA names', () => {
    for (const timeZone of [
      'Europe/Tallinn',
      'America/Argentina/Buenos_Aires',
      'UTC',
      'Etc/GMT+2',
    ]) {
      expect(v.safeParse(GetSettingsInput, { timeZone }).success).toBe(true)
    }
    for (const timeZone of ['Mars/Olympus', '+02:00', '', 'Europe/Tallinn; DROP']) {
      expect(v.safeParse(GetSettingsInput, { timeZone }).success).toBe(false)
    }
  })

  test('the week starts on Monday or Sunday', () => {
    expect(v.safeParse(UpdateSettingsInput, { weekStart: 'sun' }).success).toBe(true)
    expect(v.safeParse(UpdateSettingsInput, { weekStart: 'sat' }).success).toBe(false)
  })

  test('theme, timer layout, and app icon are known values, and show summary a boolean', () => {
    for (const patch of [
      { theme: 'light' },
      { theme: 'system' },
      { timerLayout: 'focus' },
      { showSummary: false },
      { appIcon: '01' },
      { appIcon: '12' },
    ]) {
      expect(v.safeParse(UpdateSettingsInput, patch).success).toBe(true)
    }
    for (const patch of [
      { theme: 'sepia' },
      { timerLayout: 'grid' },
      { showSummary: 1 },
      { appIcon: '13' },
      { appIcon: 2 },
    ]) {
      expect(v.safeParse(UpdateSettingsInput, patch).success).toBe(false)
    }
  })

  test('scene settings are known values, and the switches booleans', () => {
    for (const patch of [
      { sceneCollection: 'coast' },
      { scenePin: 'autumn' },
      { scenePin: 'land-december' },
      { scenePin: null },
      { sceneStrength: 'full' },
      { surfaces: 'solid' },
      { sceneBackground: false },
      { sceneWeather: true },
      { sceneIntro: false },
    ]) {
      expect(v.safeParse(UpdateSettingsInput, patch).success).toBe(true)
    }
    for (const patch of [
      { sceneCollection: 'city' },
      { scenePin: 'coast-smarch' },
      { scenePin: 'auto' },
      { sceneStrength: 'half' },
      { surfaces: 'frosted' },
      { sceneBackground: 1 },
      { sceneWeather: 'on' },
      { sceneIntro: null },
    ]) {
      expect(v.safeParse(UpdateSettingsInput, patch).success).toBe(false)
    }
  })

  test('the locale is a supported language, English by default', () => {
    expect(v.parse(GetSettingsInput, { timeZone: 'UTC' }).locale).toBe('en')
    expect(v.safeParse(UpdateSettingsInput, { locale: 'et' }).success).toBe(true)
    expect(v.safeParse(UpdateSettingsInput, { locale: 'fi' }).success).toBe(false)
  })

  test('the country is EE, US, other, or null for the time zone guess', () => {
    for (const country of ['EE', 'US', 'other', null]) {
      expect(v.safeParse(UpdateSettingsInput, { country }).success).toBe(true)
    }
    for (const country of ['ee', 'FI', '', 1]) {
      expect(v.safeParse(UpdateSettingsInput, { country }).success).toBe(false)
    }
  })
})
