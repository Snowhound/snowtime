/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as v from 'valibot'
import type { Database } from '~/db'
import { projectTeam, team, teamMember } from '~/db/schema'
import { seedIds } from '~/db/seed'
import { limits } from '../limits.server'
import { type Scope } from '../scope.server'
import { as, createSeededDatabase, scopeOf } from '../testing'
import { CreateTeamInput, RenameTeamInput } from './teams.schemas'
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  listTeams,
  removeTeamMember,
  renameTeam,
} from './teams.server'

const { users: U, orgs: O, teams: T } = seedIds
let db: Database
let cleanup: () => Promise<void>
let admin: Scope
let owner: Scope
beforeEach(async () => {
  ;({ db, cleanup } = await createSeededDatabase())
  admin = await scopeOf(db, U.admin, O.northwind)
  owner = await scopeOf(db, U.owner, O.northwind)
})
afterEach(() => cleanup())

describe('team writes', () => {
  test('admins and owners create and rename teams', async () => {
    const created = await as(admin, () => createTeam(db, admin, { name: 'Research' }))
    expect(created.name).toBe('Research')
    expect(
      await as(owner, () => renameTeam(db, owner, { teamId: created.id, name: 'Lab' })),
    ).toEqual({ id: created.id, name: 'Lab' })
  })

  test('members and leads cannot write teams or memberships', async () => {
    for (const userId of [U.member, U.lead, U.engLead, U.loner]) {
      const scope = await scopeOf(db, userId, O.northwind)
      const calls = [
        () => createTeam(db, scope, { name: 'Lab' }),
        () => renameTeam(db, scope, { teamId: T.design, name: 'Lab' }),
        () => deleteTeam(db, scope, { teamId: T.design }),
        () => addTeamMember(db, scope, { teamId: T.design, userId: U.loner }),
        () => removeTeamMember(db, scope, { teamId: T.design, userId: U.member }),
      ]
      for (const call of calls)
        await expect(as<unknown>(scope, call)).rejects.toMatchObject({
          code: 'FORBIDDEN',
          key: 'teams_forbidden',
        })
    }
  })

  test('the inputs trim names and refuse blank and long ones', () => {
    const teamId = T.design
    expect(v.parse(CreateTeamInput, { name: '  Research  ' }).name).toBe('Research')
    expect(v.parse(RenameTeamInput, { teamId, name: '  Lab  ' }).name).toBe('Lab')
    for (const name of ['  ', 'x'.repeat(101)]) {
      expect(v.safeParse(CreateTeamInput, { name }).success).toBe(false)
      expect(v.safeParse(RenameTeamInput, { teamId, name }).success).toBe(false)
    }
  })

  test('names are unique within the organization', async () => {
    await expect(createTeam(db, admin, { name: 'Design' })).rejects.toMatchObject({
      code: 'CONFLICT',
      key: 'team_name_taken',
    })
    await expect(
      renameTeam(db, admin, { teamId: T.engineering, name: 'Design' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', key: 'team_name_taken' })
    expect(await renameTeam(db, admin, { teamId: T.design, name: 'Design' })).toMatchObject({
      name: 'Design',
    })
    const harbor = await scopeOf(db, U.admin, O.harbor)
    expect(await createTeam(db, harbor, { name: 'Design' })).toMatchObject({ name: 'Design' })
  })

  test('the team cap is scoped to the organization', async () => {
    const rows = Array.from({ length: limits.teamsPerOrganization - 2 }, (_, n) => ({
      id: uuidv7(),
      organizationId: O.northwind,
      name: `Team ${n}`,
      createdAt: new Date(),
    }))
    await db.insert(team).values(rows)
    await expect(createTeam(db, admin, { name: 'Over cap' })).rejects.toMatchObject({
      code: 'LIMIT_REACHED',
      key: 'team_limit',
    })
    const harbor = await scopeOf(db, U.admin, O.harbor)
    expect(await createTeam(db, harbor, { name: 'Under cap' })).toMatchObject({ name: 'Under cap' })
  })

  test('writes refuse foreign and missing teams', async () => {
    for (const teamId of [T.delivery, uuidv7()]) {
      for (const call of [
        () => renameTeam(db, admin, { teamId, name: 'Lab' }),
        () => deleteTeam(db, admin, { teamId }),
        () => addTeamMember(db, admin, { teamId, userId: U.loner }),
        () => removeTeamMember(db, admin, { teamId, userId: U.member }),
      ])
        await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND', key: 'team_not_found' })
    }
  })

  test('members must belong to the organization; repeated additions preserve lead roles and counts', async () => {
    const harbor = await scopeOf(db, U.admin, O.harbor)
    await expect(
      addTeamMember(db, harbor, { teamId: T.delivery, userId: U.loner }),
    ).rejects.toMatchObject({ key: 'member_not_found' })
    await expect(
      addTeamMember(db, admin, { teamId: T.design, userId: uuidv7() }),
    ).rejects.toMatchObject({ key: 'member_not_found' })
    const [before] = await db.select().from(team).where(eq(team.id, T.design))
    await addTeamMember(db, admin, { teamId: T.design, userId: U.lead })
    expect((await listTeams(db, admin)).find((t) => t.id === T.design)?.members).toContainEqual({
      userId: U.lead,
      role: 'lead',
    })
    await addTeamMember(db, owner, { teamId: T.design, userId: U.loner })
    await addTeamMember(db, owner, { teamId: T.design, userId: U.loner })
    expect((await db.select().from(team).where(eq(team.id, T.design)))[0].memberCount).toBe(
      before.memberCount + 1,
    )
    await removeTeamMember(db, admin, { teamId: T.design, userId: U.loner })
    expect((await db.select().from(team).where(eq(team.id, T.design)))[0].memberCount).toBe(
      before.memberCount,
    )
    await expect(
      removeTeamMember(db, owner, { teamId: T.design, userId: U.loner }),
    ).rejects.toMatchObject({ key: 'team_member_not_found' })
  })

  test('deleting teams cascades memberships and assignments, including the last team', async () => {
    await deleteTeam(db, admin, { teamId: T.design })
    expect(await db.select().from(teamMember).where(eq(teamMember.teamId, T.design))).toEqual([])
    expect(await db.select().from(projectTeam).where(eq(projectTeam.teamId, T.design))).toEqual([])
    await deleteTeam(db, owner, { teamId: T.engineering })
    expect(await listTeams(db, admin)).toEqual([])
    expect(await db.select().from(team).where(eq(team.id, T.delivery))).toHaveLength(1)
  })
})
