/// <reference types="bun" />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '~/db'
import { invitation } from '~/db/schema'
import { seedIds } from '~/db/seed'
import { createSeededDatabase } from '../testing'
import { invitationPreview } from './invitations.server'

const { users: U, orgs: O, teams: T } = seedIds
const NOW = new Date('2026-09-23T12:00:00Z')
const HOUR = 60 * 60 * 1000

let db: Database
let cleanup: () => void

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase(NOW))
})

afterAll(() => cleanup())

async function invite(values: Partial<typeof invitation.$inferInsert> = {}) {
  const id = uuidv7()
  await db.insert(invitation).values({
    id,
    organizationId: O.northwind,
    email: 'anna@example.com',
    role: 'member',
    status: 'pending',
    expiresAt: new Date(NOW.getTime() + 48 * HOUR),
    inviterId: U.owner,
    createdAt: NOW,
    ...values,
  })
  return id
}

describe('invitationPreview', () => {
  test('names the organization, team, inviter, role, and invited address', async () => {
    const id = await invite({ role: 'admin', teamId: T.design })
    expect(await invitationPreview(db, id, NOW)).toEqual({
      id,
      email: 'anna@example.com',
      role: 'admin',
      organizationId: O.northwind,
      organizationName: 'Northwind Studio',
      teamName: 'Design',
      inviterName: 'Olivia Owner',
      state: 'pending',
    })
  })

  test('an invitation without a team or role joins as a member', async () => {
    const id = await invite({ role: null })
    const preview = await invitationPreview(db, id, NOW)
    expect(preview?.teamName).toBeNull()
    expect(preview?.role).toBe('member')
  })

  test('an invitation past its expiry is expired', async () => {
    const id = await invite({ expiresAt: NOW })
    expect((await invitationPreview(db, id, NOW))?.state).toBe('expired')
  })

  test('accepted, rejected, and canceled invitations are closed, even when expired', async () => {
    for (const status of ['accepted', 'rejected', 'canceled']) {
      const id = await invite({ status, expiresAt: new Date(NOW.getTime() - HOUR) })
      expect((await invitationPreview(db, id, NOW))?.state).toBe('closed')
    }
  })

  test('an unknown id returns null', async () => {
    expect(await invitationPreview(db, uuidv7(), NOW)).toBeNull()
  })
})
