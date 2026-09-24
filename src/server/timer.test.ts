/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '../db'
import { seedIds } from '../db/seed'
import { as, createSeededDatabase, scopeOf } from './testing'
import { getRunningTimer, startTimer, stopTimer } from './timer.server'

const { users: U, orgs: O, projects: P, entries: E } = seedIds

let db: Database
let cleanup: () => void

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase())
})

afterAll(() => cleanup())

describe('timer', () => {
  test('getRunningTimer returns the running entry with its project', async () => {
    const running = await getRunningTimer(db, U.member)
    expect(running?.id).toBe(E.running)
    expect(running?.project?.name).toBe('Website redesign')
    expect(await getRunningTimer(db, U.owner)).toBeNull()
  })

  test('starting a timer in another organization stops the running one first', async () => {
    const scope = await scopeOf(db, U.member, O.harbor)
    const id = uuidv7()
    const { started, stopped } = await as(scope, () =>
      startTimer(db, scope, { id, description: 'Audit', projectId: P.audit }),
    )
    expect(started).toMatchObject({ id, organizationId: O.harbor, stoppedAt: null, createdBy: U.member })
    expect(stopped?.id).toBe(E.running)
    expect(stopped?.stoppedAt).not.toBeNull()
    expect((await getRunningTimer(db, U.member))?.id).toBe(id)
  })

  test('stopTimer stops only the given running entry, in any organization', async () => {
    const running = await getRunningTimer(db, U.member)
    await expect(as({ userId: U.member }, () => stopTimer(db, U.member, { id: E.running }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(as({ userId: U.lead }, () => stopTimer(db, U.lead, { id: running!.id }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    const stopped = await as({ userId: U.member }, () => stopTimer(db, U.member, { id: running!.id }))
    expect(stopped.stoppedAt!.getTime()).toBeGreaterThan(stopped.startedAt.getTime())
    expect(stopped.updatedBy).toBe(U.member)
    expect(await getRunningTimer(db, U.member)).toBeNull()
  })

  test('a start without a project, and a client id reused, is a conflict', async () => {
    const scope = await scopeOf(db, U.owner, O.northwind)
    const id = uuidv7()
    await as(scope, () => startTimer(db, scope, { id, description: '', projectId: null }))
    await expect(as(scope, () => startTimer(db, scope, { id, description: '' }))).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    // The failed start rolled back: the first timer is still running.
    expect((await getRunningTimer(db, U.owner))?.id).toBe(id)
  })

  describe('projects', () => {
    const start = async (userId: string, projectId: string) => {
      const scope = await scopeOf(db, userId, O.northwind)
      return as(scope, () => startTimer(db, scope, { id: uuidv7(), description: '', projectId }))
    }

    test('an archived project is rejected', async () => {
      await expect(start(U.engLead, P.legacy)).rejects.toMatchObject({ code: 'CONFLICT' })
    })

    test('a deleted project or one from another organization is not found', async () => {
      await expect(start(U.engLead, P.scrapped)).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(start(U.engLead, P.audit)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    test("a member cannot use another team's project; an admin can", async () => {
      await expect(start(U.lead, P.mobile)).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await start(U.admin, P.mobile)
      await start(U.lead, P.internal)
    })
  })
})
