/// <reference types="bun" />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '~/db'
import { invitation, user } from '~/db/schema'
import { seedIds } from '~/db/seed'
import { createSeededDatabase } from '../testing'
import { appSession } from './session.server'

const { users: U, orgs: O } = seedIds
const NOW = new Date('2026-09-23T12:00:00Z')
const HOUR = 60 * 60 * 1000

let db: Database
let cleanup: () => void

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase(NOW))
})

afterAll(() => cleanup())

function seeded(id: string, email: string) {
  return { id, email }
}

// A signed-up user in no organization and without settings.
async function newUser(email: string) {
  const id = uuidv7()
  await db.insert(user).values({ id, name: 'New', email, createdAt: NOW, updatedAt: NOW })
  return { id, email }
}

async function invite(email: string, values: { status?: string; expiresAt?: Date } = {}) {
  const id = uuidv7()
  await db.insert(invitation).values({
    id,
    organizationId: O.northwind,
    email,
    role: 'member',
    status: values.status ?? 'pending',
    expiresAt: values.expiresAt ?? new Date(NOW.getTime() + 48 * HOUR),
    inviterId: U.owner,
    createdAt: NOW,
  })
  return id
}

describe('appSession', () => {
  test('lists the organizations by name with the role in each', async () => {
    const session = await appSession(db, seeded(U.admin, 'admin@example.com'), O.northwind, NOW)
    expect(session.organizations).toEqual([
      { id: O.harbor, name: 'Harbor Consulting', slug: 'harbor', role: 'owner' },
      { id: O.northwind, name: 'Northwind Studio', slug: 'northwind', role: 'admin' },
    ])
    expect(session.activeOrganizationId).toBe(O.northwind)
    expect(session.role).toBe('admin')
    expect(session.settings).toEqual({
      timeZone: 'Europe/Berlin',
      weekStart: 'mon',
      locale: 'en',
      theme: 'system',
      timerLayout: 'bar',
      showSummary: true,
      compactRows: false,
      appIcon: '02',
      sceneSeason: 'auto',
      sceneBackground: true,
      sceneStrength: 'dimmed',
      surfaces: 'glass',
      sceneWeather: true,
      sceneIntro: true,
    })
    expect(session.invitationId).toBeNull()
  })

  test('without an active organization, the first by name stands in', async () => {
    const session = await appSession(db, seeded(U.admin, 'admin@example.com'), null, NOW)
    expect(session.activeOrganizationId).toBe(O.harbor)
    expect(session.role).toBe('owner')
  })

  test('an active organization the user has left is replaced', async () => {
    const session = await appSession(db, seeded(U.owner, 'owner@example.com'), O.harbor, NOW)
    expect(session.activeOrganizationId).toBe(O.northwind)
    expect(session.role).toBe('owner')
  })

  test('a user with no organization gets their open invitation, matched case-insensitively', async () => {
    const newcomer = await newUser('newcomer@example.com')
    await invite('newcomer@example.com', { expiresAt: new Date(NOW.getTime() - HOUR) })
    await invite('newcomer@example.com', { status: 'canceled' })
    const open = await invite('NewComer@Example.com')

    const session = await appSession(db, newcomer, null, NOW)
    expect(session).toEqual({
      organizations: [],
      activeOrganizationId: null,
      role: null,
      settings: null,
      invitationId: open,
    })
  })

  test('a user with no organization and no open invitation gets none', async () => {
    const loner = await newUser('nobody@example.com')
    const session = await appSession(db, loner, null, NOW)
    expect(session.invitationId).toBeNull()
  })
})
