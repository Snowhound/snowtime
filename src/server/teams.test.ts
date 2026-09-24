/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Database } from '../db'
import { seedIds } from '../db/seed'
import { readableUserIds, type Scope } from './scope.server'
import { listMembers, listTeams, setTeamRole } from './teams.server'
import { as, createSeededDatabase, scopeOf } from './testing'

const { users: U, orgs: O, teams: T } = seedIds

let db: Database
let cleanup: () => void
const scopes: Record<keyof typeof U, Scope> = {} as never

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase(new Date('2026-09-23T12:00:00Z')))
  for (const [key, id] of Object.entries(U)) {
    scopes[key as keyof typeof U] = await scopeOf(db, id, O.northwind)
  }
})

afterAll(() => cleanup())

describe('listTeams', () => {
  test("the organization's teams by name, with members and team roles", async () => {
    const teams = await listTeams(db, scopes.loner)
    expect(teams.map((t) => t.id)).toEqual([T.design, T.engineering])
    const design = teams[0]
    expect(design.name).toBe('Design')
    expect(design.members).toEqual(
      expect.arrayContaining([
        { userId: U.lead, role: 'lead' },
        { userId: U.member, role: 'member' },
      ]),
    )
    expect(design.members).toHaveLength(2)
  })
})

describe('listMembers', () => {
  test('every member of the organization, with org role and teams; none from other organizations', async () => {
    const members = await listMembers(db, scopes.member)
    expect(members.map((m) => m.userId).sort()).toEqual(Object.values(U).sort())
    const byId = Object.fromEntries(members.map((m) => [m.userId, m]))
    expect(byId[U.owner]).toMatchObject({ orgRole: 'owner', teams: [] })
    expect(byId[U.admin].orgRole).toBe('admin')
    expect(byId[U.member].teams).toEqual(
      expect.arrayContaining([
        { teamId: T.design, role: 'member' },
        { teamId: T.engineering, role: 'member' },
      ]),
    )
    // Mia leads Delivery in Harbor, which Northwind must not show.
    expect(byId[U.engineer].teams).toEqual([{ teamId: T.engineering, role: 'member' }])
  })

  test('names come sorted, for pickers', async () => {
    const names = (await listMembers(db, scopes.admin)).map((m) => m.name)
    expect(names).toEqual([...names].sort())
  })
})

describe('setTeamRole', () => {
  test('an admin makes a member a lead, who then reads the team; and back', async () => {
    const promote = { teamId: T.engineering, userId: U.engineer, role: 'lead' } as const
    expect(await as(scopes.admin, () => setTeamRole(db, scopes.admin, promote))).toEqual(promote)
    const mia = await scopeOf(db, U.engineer, O.northwind)
    expect(mia.ledTeamIds).toEqual([T.engineering])
    expect(await readableUserIds(db, mia)).toEqual(expect.arrayContaining([U.member, U.engLead]))

    await as(scopes.owner, () => setTeamRole(db, scopes.owner, { ...promote, role: 'member' }))
    expect((await scopeOf(db, U.engineer, O.northwind)).ledTeamIds).toEqual([])
  })

  test('a team can have several leads', async () => {
    await as(scopes.owner, () =>
      setTeamRole(db, scopes.owner, { teamId: T.design, userId: U.member, role: 'lead' }),
    )
    const design = (await listTeams(db, scopes.owner)).find((t) => t.id === T.design)!
    expect(design.members.filter((m) => m.role === 'lead').map((m) => m.userId).sort()).toEqual(
      [U.lead, U.member].sort(),
    )
    await as(scopes.owner, () =>
      setTeamRole(db, scopes.owner, { teamId: T.design, userId: U.member, role: 'member' }),
    )
  })

  test('members and team leads cannot change team roles, not even in their own team', async () => {
    for (const scope of [scopes.lead, scopes.member, scopes.engLead]) {
      await expect(
        as(scope, () => setTeamRole(db, scope, { teamId: T.design, userId: U.member, role: 'lead' })),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
  })

  test('the user must be on the team, and the team in the organization', async () => {
    await expect(
      as(scopes.admin, () => setTeamRole(db, scopes.admin, { teamId: T.design, userId: U.loner, role: 'lead' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', key: 'team_member_not_found' })
    await expect(
      as(scopes.admin, () =>
        setTeamRole(db, scopes.admin, { teamId: T.delivery, userId: U.engineer, role: 'member' }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', key: 'team_not_found' })
  })
})
