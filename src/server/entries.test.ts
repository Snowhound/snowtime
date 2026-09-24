/// <reference types="bun" />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '../db'
import { SYSTEM_USER_ID } from '../db/actor'
import { seedIds } from '../db/seed'
import { createEntry, deleteEntry, listEntries, updateEntry } from './entries.server'
import type { Scope } from './scope.server'
import { as, createSeededDatabase, scopeOf } from './testing'

const { users: U, orgs: O, projects: P, entries: E } = seedIds

// Wednesday; the seed covers the three weeks before it.
const NOW = new Date('2026-09-23T12:00:00Z')
const TODAY = new Date('2026-09-23T00:00:00Z')
const DAY = 86_400_000
const range = { from: new Date(NOW.getTime() - 22 * DAY), to: new Date(NOW.getTime() + DAY) }

let db: Database
let cleanup: () => void
const scopes: Record<keyof typeof U, Scope> = {} as never

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase(NOW))
  for (const [key, id] of Object.entries(U)) {
    scopes[key as keyof typeof U] = await scopeOf(db, id, O.northwind)
  }
})

afterAll(() => cleanup())

function usersIn(entries: { userId: string }[]) {
  return [...new Set(entries.map((e) => e.userId))].sort()
}
function past(hoursAgo: number, hours = 1) {
  return {
    startedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000),
    stoppedAt: new Date(NOW.getTime() - (hoursAgo - hours) * 3_600_000),
  }
}

describe('listEntries', () => {
  test('member: own entries only, including the running timer', async () => {
    const entries = await listEntries(db, scopes.member, range)
    expect(usersIn(entries)).toEqual([U.member])
    expect(entries[0].id).toBe(E.running)
  })

  test("team lead: own entries and the led team's members'", async () => {
    expect(usersIn(await listEntries(db, scopes.lead, range))).toEqual([U.lead, U.member].sort())
    expect(usersIn(await listEntries(db, scopes.engLead, range))).toEqual(
      [U.member, U.engLead, U.engineer].sort(),
    )
  })

  test('admin and owner: everyone in the organization, never deleted rows or other organizations', async () => {
    for (const scope of [scopes.admin, scopes.owner]) {
      const entries = await listEntries(db, scope, range)
      expect(usersIn(entries)).toEqual(Object.values(U).sort())
      const ids = entries.map((e) => e.id)
      expect(ids).not.toContain(E.deleted)
      expect(ids).not.toContain(E.harbor)
    }
  })

  test('filtering by user is limited to readable users', async () => {
    const maxOnly = await listEntries(db, scopes.lead, { ...range, userId: U.member })
    expect(usersIn(maxOnly)).toEqual([U.member])
    await expect(
      listEntries(db, scopes.lead, { ...range, userId: U.engineer }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      listEntries(db, scopes.member, { ...range, userId: U.lead }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  test('entries overlapping the range start are included', async () => {
    const today = await listEntries(db, scopes.engLead, {
      from: TODAY,
      to: new Date(TODAY.getTime() + DAY),
      userId: U.engLead,
    })
    expect(today.map((e) => e.id)).toEqual([E.overnight])
  })
})

describe('createEntry', () => {
  test('a member logs a past entry for themselves', async () => {
    const id = uuidv7()
    const entry = await as(scopes.member, () =>
      createEntry(db, scopes.member, {
        id,
        description: 'Call',
        projectId: P.website,
        ...past(30),
      }),
    )
    expect(entry).toMatchObject({
      id,
      userId: U.member,
      organizationId: O.northwind,
      createdBy: U.member,
    })
  })

  test('only admins and owners log entries for other members', async () => {
    function forMax() {
      return { id: uuidv7(), userId: U.member, description: '', ...past(40) }
    }
    await expect(
      as(scopes.lead, () => createEntry(db, scopes.lead, forMax())),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      as(scopes.engineer, () => createEntry(db, scopes.engineer, forMax())),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const entry = await as(scopes.admin, () => createEntry(db, scopes.admin, forMax()))
    expect(entry).toMatchObject({ userId: U.member, createdBy: U.admin })
  })

  test('the other user must be a member of the organization', async () => {
    await expect(
      as(scopes.owner, () =>
        createEntry(db, scopes.owner, {
          id: uuidv7(),
          userId: SYSTEM_USER_ID,
          description: '',
          ...past(40),
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  test('archived projects are rejected for new entries', async () => {
    await expect(
      as(scopes.engLead, () =>
        createEntry(db, scopes.engLead, {
          id: uuidv7(),
          description: '',
          projectId: P.legacy,
          ...past(50),
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('updateEntry', () => {
  async function newEntry(scope: Scope, projectId: string | null = null) {
    return as(scope, () =>
      createEntry(db, scope, { id: uuidv7(), description: 'Draft', projectId, ...past(60) }),
    )
  }

  test('a member updates their own entry', async () => {
    const entry = await newEntry(scopes.member)
    const updated = await as(scopes.member, () =>
      updateEntry(db, scopes.member, { id: entry.id, description: 'Final', projectId: P.mobile }),
    )
    expect(updated).toMatchObject({
      description: 'Final',
      projectId: P.mobile,
      updatedBy: U.member,
    })
    expect(updated.startedAt).toEqual(entry.startedAt)
  })

  test("a team lead cannot change a team member's entry; an admin can", async () => {
    const entry = await newEntry(scopes.member)
    await expect(
      as(scopes.lead, () => updateEntry(db, scopes.lead, { id: entry.id, description: 'Lead' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const updated = await as(scopes.admin, () =>
      updateEntry(db, scopes.admin, { id: entry.id, description: 'Admin' }),
    )
    expect(updated).toMatchObject({ description: 'Admin', userId: U.member, updatedBy: U.admin })
  })

  test('the end must stay after the start, and a running entry is stopped by the timer', async () => {
    const entry = await newEntry(scopes.member)
    await expect(
      as(scopes.member, () =>
        updateEntry(db, scopes.member, { id: entry.id, startedAt: entry.stoppedAt! }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID' })
    await expect(
      as(scopes.member, () => updateEntry(db, scopes.member, { id: E.running, stoppedAt: NOW })),
    ).rejects.toMatchObject({ code: 'INVALID' })
  })

  test('time cannot move onto an archived project, but an entry already on one stays editable', async () => {
    const entry = await newEntry(scopes.engLead)
    await expect(
      as(scopes.engLead, () =>
        updateEntry(db, scopes.engLead, { id: entry.id, projectId: P.legacy }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const [onLegacy] = (
      await listEntries(db, scopes.engLead, { ...range, userId: U.engLead })
    ).filter((e) => e.projectId === P.legacy)
    const updated = await as(scopes.engLead, () =>
      updateEntry(db, scopes.engLead, {
        id: onLegacy.id,
        projectId: P.legacy,
        description: 'Kept',
      }),
    )
    expect(updated.description).toBe('Kept')
  })

  test('entries of another organization are not found', async () => {
    await expect(
      as(scopes.admin, () => updateEntry(db, scopes.admin, { id: E.harbor, description: 'x' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('deleteEntry', () => {
  test('a member deletes their own entry, which then disappears from lists', async () => {
    const entry = await as(scopes.member, () =>
      createEntry(db, scopes.member, { id: uuidv7(), description: 'Oops', ...past(70) }),
    )
    await as(scopes.member, () => deleteEntry(db, scopes.member, { id: entry.id }))
    const ids = (await listEntries(db, scopes.member, range)).map((e) => e.id)
    expect(ids).not.toContain(entry.id)
    await expect(
      as(scopes.member, () => deleteEntry(db, scopes.member, { id: entry.id })),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  test("only admins and owners delete other members' entries", async () => {
    const entry = await as(scopes.member, () =>
      createEntry(db, scopes.member, { id: uuidv7(), description: 'Keep', ...past(80) }),
    )
    await expect(
      as(scopes.engLead, () => deleteEntry(db, scopes.engLead, { id: entry.id })),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await as(scopes.owner, () => deleteEntry(db, scopes.owner, { id: entry.id }))
    const ids = (await listEntries(db, scopes.owner, range)).map((e) => e.id)
    expect(ids).not.toContain(entry.id)
  })
})
