/// <reference types="bun" />

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import type { Database } from '~/db'
import { member, organization, team, teamMember, user } from '~/db/schema'
import { createTestDatabase } from '~/db/testing'
import {
  isAdmin,
  readableUserIds,
  resolveScope,
  resolveSessionScope,
  strongestRole,
} from './scope.server'

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

describe('strongestRole', () => {
  test('reads a role list as Better Auth does, so a padded role grants nothing', () => {
    expect(strongestRole('member,owner')).toBe('owner')
    expect(strongestRole('admin')).toBe('admin')
    // An admin can invite with "member, owner", which Better Auth's owner check misses
    // and its permission check reads as a plain member.
    expect(strongestRole('member, owner')).toBe('member')
    expect(strongestRole(' admin')).toBe('member')
  })
})

describe('resolveSessionScope', () => {
  // getAppSession has saved an organization since the request's cookie was cached.
  test('reads the session again when the cached one has no organization', async () => {
    const reread = mock(async () => 'org-a')
    const scope = await resolveSessionScope(db, 'member', null, reread)
    expect(scope.organizationId).toBe('org-a')
    expect(reread).toHaveBeenCalledTimes(1)
  })

  test('reads the session again when the cached organization is one the user left', async () => {
    const scope = await resolveSessionScope(db, 'member', 'org-b', async () => 'org-a')
    expect(scope.organizationId).toBe('org-a')
  })

  test('keeps a cached organization the user belongs to, without reading again', async () => {
    const reread = mock(async () => 'org-b')
    const scope = await resolveSessionScope(db, 'lead', 'org-a', reread)
    expect(scope.organizationId).toBe('org-a')
    expect(reread).not.toHaveBeenCalled()
  })

  test('refuses as before when the stored session has nothing better', async () => {
    await expect(resolveSessionScope(db, 'member', null, async () => null)).rejects.toMatchObject({
      code: 'NO_ACTIVE_ORGANIZATION',
    })
    await expect(
      resolveSessionScope(db, 'member', 'org-b', async () => 'org-b'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  // Task 049: another tab switched the session to org-b while this one still shows org-a.
  test('refuses a call for an organization the tab shows but the session left', async () => {
    const reread = mock(async () => 'org-b')
    await expect(resolveSessionScope(db, 'lead', 'org-b', reread, 'org-a')).rejects.toMatchObject({
      code: 'ORGANIZATION_CHANGED',
    })
    // The cookie cache may lag behind the stored session, so the refusal is checked there.
    expect(reread).toHaveBeenCalledTimes(1)
  })

  test('takes the organization the tab shows when the stored session agrees', async () => {
    const scope = await resolveSessionScope(db, 'lead', 'org-b', async () => 'org-a', 'org-a')
    expect(scope.organizationId).toBe('org-a')
    const cached = await resolveSessionScope(db, 'member', null, async () => 'org-a', 'org-a')
    expect(cached.organizationId).toBe('org-a')
  })

  test('never answers for another organization than the one the tab shows', async () => {
    // The session's organization is one the user left, and the stored one differs.
    await expect(
      resolveSessionScope(db, 'member', 'org-b', async () => 'org-a', 'org-b'),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_CHANGED' })
    await expect(
      resolveSessionScope(db, 'member', null, async () => null, 'org-a'),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_CHANGED' })
  })

  test('checks nothing more when the call names no organization', async () => {
    const reread = mock(async () => 'org-b')
    const scope = await resolveSessionScope(db, 'lead', 'org-a', reread, undefined)
    expect(scope.organizationId).toBe('org-a')
    expect(reread).not.toHaveBeenCalled()
  })
})
