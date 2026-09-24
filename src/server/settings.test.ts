/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import * as v from 'valibot'
import type { Database } from '../db'
import { user } from '../db/schema'
import { seedIds } from '../db/seed'
import { GetSettingsInput, UpdateSettingsInput } from '../schemas/settings'
import { getSettings, updateSettings } from './settings.server'
import { as, createSeededDatabase } from './testing'

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
    const save = (patch: UpdateSettingsInput) =>
      as({ userId: U.loner }, () => updateSettings(db, U.loner, patch))
    await save({ theme: 'dark' })
    await save({ timerLayout: 'table' })
    const last = await save({ showSummary: false })
    expect(last).toEqual({
      ...DEFAULTS,
      timeZone: 'Europe/London',
      theme: 'dark',
      timerLayout: 'table',
      showSummary: false,
    })
    expect(await save({})).toEqual(last)
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

  test('theme and timer layout are known values, and show summary a boolean', () => {
    for (const patch of [
      { theme: 'light' },
      { theme: 'system' },
      { timerLayout: 'focus' },
      { showSummary: false },
    ]) {
      expect(v.safeParse(UpdateSettingsInput, patch).success).toBe(true)
    }
    for (const patch of [{ theme: 'sepia' }, { timerLayout: 'grid' }, { showSummary: 1 }]) {
      expect(v.safeParse(UpdateSettingsInput, patch).success).toBe(false)
    }
  })

  test('the locale is a supported language, English by default', () => {
    expect(v.parse(GetSettingsInput, { timeZone: 'UTC' }).locale).toBe('en')
    expect(v.safeParse(UpdateSettingsInput, { locale: 'et' }).success).toBe(true)
    expect(v.safeParse(UpdateSettingsInput, { locale: 'fi' }).success).toBe(false)
  })
})
