/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Database } from '../db'
import { member, organization, team, teamMember, user } from '../db/schema'
import { createTestDatabase } from '../db/testing'
import { isAdmin, readableUserIds, resolveScope } from './scope.server'

let db: Database
let cleanup: () => void
const now = new Date()

beforeAll(async () => {
  ;({ db, cleanup } = await createTestDatabase())
  const people = ['owner', 'admin', 'lead', 'member', 'outsider', 'multi']
  await db.insert(user).values(
    people.map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
      createdAt: now,
      updatedAt: now,
    })),
  )
  await db.insert(organization).values([
    { id: 'org-a', name: 'A', slug: 'a', createdAt: now },
    { id: 'org-b', name: 'B', slug: 'b', createdAt: now },
  ])
  await db.insert(member).values([
    { id: 'm1', organizationId: 'org-a', userId: 'owner', role: 'owner', createdAt: now },
    { id: 'm2', organizationId: 'org-a', userId: 'admin', role: 'admin', createdAt: now },
    { id: 'm3', organizationId: 'org-a', userId: 'lead', role: 'member', createdAt: now },
    { id: 'm4', organizationId: 'org-a', userId: 'member', role: 'member', createdAt: now },
    { id: 'm5', organizationId: 'org-a', userId: 'multi', role: 'member,admin', createdAt: now },
    { id: 'm6', organizationId: 'org-b', userId: 'lead', role: 'member', createdAt: now },
    { id: 'm7', organizationId: 'org-b', userId: 'outsider', role: 'owner', createdAt: now },
  ])
  await db.insert(team).values([
    { id: 't-a', organizationId: 'org-a', name: 'A team', createdAt: now },
    { id: 't-b', organizationId: 'org-b', name: 'B team', createdAt: now },
  ])
  await db.insert(teamMember).values([
    { id: 'tm1', teamId: 't-a', userId: 'lead', role: 'lead' },
    { id: 'tm2', teamId: 't-a', userId: 'member' },
    { id: 'tm3', teamId: 't-b', userId: 'lead', role: 'lead' },
    { id: 'tm4', teamId: 't-b', userId: 'outsider' },
  ])
})

afterAll(() => cleanup())

describe('resolveScope', () => {
  test('requires an active organization', async () => {
    await expect(resolveScope(db, 'member', null)).rejects.toMatchObject({
      code: 'NO_ACTIVE_ORGANIZATION',
    })
  })

  test('refuses a user who is not a member', async () => {
    await expect(resolveScope(db, 'outsider', 'org-a')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('member: own entries only', async () => {
    const scope = await resolveScope(db, 'member', 'org-a')
    expect(scope).toEqual({
      userId: 'member',
      organizationId: 'org-a',
      orgRole: 'member',
      ledTeamIds: [],
    })
    expect(isAdmin(scope)).toBe(false)
    expect(await readableUserIds(db, scope)).toEqual(['member'])
  })

  test('team lead: own entries plus the led team, in the active organization only', async () => {
    const scope = await resolveScope(db, 'lead', 'org-a')
    expect(scope.orgRole).toBe('member')
    expect(scope.ledTeamIds).toEqual(['t-a'])
    expect((await readableUserIds(db, scope))!.sort()).toEqual(['lead', 'member'])
  })

  test('admin and owner read everyone', async () => {
    for (const id of ['admin', 'owner']) {
      const scope = await resolveScope(db, id, 'org-a')
      expect(isAdmin(scope)).toBe(true)
      expect(await readableUserIds(db, scope)).toBeNull()
    }
  })

  test('the strongest of several roles wins', async () => {
    expect((await resolveScope(db, 'multi', 'org-a')).orgRole).toBe('admin')
  })
})
