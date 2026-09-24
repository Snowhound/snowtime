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

// A signed-up user who has not loaded the app yet, so has no settings row.
async function newUser() {
  const id = uuidv7()
  const now = new Date()
  await db.insert(user).values({ id, name: 'New', email: `${id}@example.com`, createdAt: now, updatedAt: now })
  return id
}

describe('getSettings', () => {
  test("the first call creates the settings with the browser's zone and locale; later calls keep them", async () => {
    const userId = await newUser()
    const first = await as({ userId }, () => getSettings(db, userId, { timeZone: 'Asia/Tokyo', locale: 'et' }))
    expect(first).toEqual({ timeZone: 'Asia/Tokyo', weekStart: 'mon', locale: 'et' })
    const again = await as({ userId }, () =>
      getSettings(db, userId, { timeZone: 'Europe/Paris', locale: 'en' }),
    )
    expect(again).toEqual(first)
  })

  test('seeded users get their own settings', async () => {
    const settings = await as({ userId: U.engLead }, () => getSettings(db, U.engLead, { timeZone: 'UTC', locale: 'et' }))
    expect(settings).toEqual({ timeZone: 'America/New_York', weekStart: 'mon', locale: 'en' })
  })
})

describe('updateSettings', () => {
  test("changes only the fields present, and only the user's own row", async () => {
    const updated = await as({ userId: U.member }, () => updateSettings(db, U.member, { weekStart: 'sun' }))
    expect(updated).toEqual({ timeZone: 'Europe/Tallinn', weekStart: 'sun', locale: 'en' })
    const zone = await as({ userId: U.member }, () =>
      updateSettings(db, U.member, { timeZone: 'America/Los_Angeles', locale: 'et' }),
    )
    expect(zone).toEqual({ timeZone: 'America/Los_Angeles', weekStart: 'sun', locale: 'et' })
    const other = await as({ userId: U.lead }, () => getSettings(db, U.lead, { timeZone: 'UTC', locale: 'en' }))
    expect(other).toEqual({ timeZone: 'Europe/Tallinn', weekStart: 'mon', locale: 'en' })
  })

  test('a user without settings is told to load them first', async () => {
    const userId = await newUser()
    await expect(as({ userId }, () => updateSettings(db, userId, { weekStart: 'sun' }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('settings input', () => {
  test('time zones must be IANA names', () => {
    for (const timeZone of ['Europe/Tallinn', 'America/Argentina/Buenos_Aires', 'UTC', 'Etc/GMT+2']) {
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

  test('the locale is a supported language, English by default', () => {
    expect(v.parse(GetSettingsInput, { timeZone: 'UTC' }).locale).toBe('en')
    expect(v.safeParse(UpdateSettingsInput, { locale: 'et' }).success).toBe(true)
    expect(v.safeParse(UpdateSettingsInput, { locale: 'fi' }).success).toBe(false)
  })
})
