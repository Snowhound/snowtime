/// <reference types="bun" />

// Runs the real migrations on a throwaway database and checks the rules the schema enforces.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '.'
import { withActor } from './actor'
import { organization, project, projectTeam, teamMember, team, timeEntry, user } from './schema'
import { createTestDatabase } from './testing'

let db: Database
let cleanup: () => void

const now = new Date()
const alice = 'user-alice'
const bob = 'user-bob'

beforeAll(async () => {
  ;({ db, cleanup } = await createTestDatabase())
  await db.insert(user).values([
    { id: alice, name: 'Alice', email: 'alice@example.com', createdAt: now, updatedAt: now },
    { id: bob, name: 'Bob', email: 'bob@example.com', createdAt: now, updatedAt: now },
  ])
  await db.insert(organization).values([
    { id: 'org-a', name: 'A', slug: 'a', createdAt: now },
    { id: 'org-b', name: 'B', slug: 'b', createdAt: now },
  ])
})

afterAll(() => cleanup())

describe('audit columns', () => {
  test('a write without an actor fails', async () => {
    await expect(
      (async () =>
        db.insert(project).values({ id: 'p-none', organizationId: 'org-a', name: 'None' }))(),
    ).rejects.toThrow('without an actor')
  })

  test('insert fills created_* and updated_* from the actor and the database clock', async () => {
    const [row] = await withActor(alice, async () =>
      db.insert(project).values({ id: 'p-1', organizationId: 'org-a', name: 'One' }).returning(),
    )
    expect(row.createdBy).toBe(alice)
    expect(row.updatedBy).toBe(alice)
    expect(row.sysDeleted).toBe(false)
    expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(5_000)
  })

  test('a Drizzle update sets updated_by and updated_at', async () => {
    const before = await db.query.project.findFirst({ where: { id: 'p-1' } })
    await Bun.sleep(5)
    const [row] = await withActor(bob, async () =>
      db.update(project).set({ name: 'One renamed' }).where(eq(project.id, 'p-1')).returning(),
    )
    expect(row.updatedBy).toBe(bob)
    expect(row.createdBy).toBe(alice)
    expect(row.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime())
  })

  test('the trigger sets updated_at when a raw update leaves it unchanged', async () => {
    const before = await db.query.project.findFirst({ where: { id: 'p-1' } })
    await Bun.sleep(5)
    await db.run(sql`UPDATE project SET color = '#4E79A7' WHERE id = 'p-1'`)
    const after = await db.query.project.findFirst({ where: { id: 'p-1' } })
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime())
  })
})

describe('tenancy', () => {
  test('a time entry cannot use a project from another organization', async () => {
    await withActor(alice, async () =>
      db.insert(project).values({ id: 'p-b', organizationId: 'org-b', name: 'B project' }),
    )
    await expect(
      withActor(alice, async () =>
        db.insert(timeEntry).values({
          id: 'e-cross',
          organizationId: 'org-a',
          userId: alice,
          projectId: 'p-b',
          startedAt: now,
        }),
      ),
    ).rejects.toThrow()
  })

  test("a project can't be assigned to a team of another organization", async () => {
    await db
      .insert(team)
      .values({ id: 't-b', organizationId: 'org-b', name: 'B team', createdAt: now })
    await withActor(alice, async () =>
      db.insert(project).values({ id: 'p-a', organizationId: 'org-a', name: 'A project' }),
    )
    for (const organizationId of ['org-a', 'org-b']) {
      const error = await withActor(alice, async () =>
        db.insert(projectTeam).values({ projectId: 'p-a', teamId: 't-b', organizationId }),
      ).catch((e: Error) => e)
      expect(String((error as Error).cause)).toContain('FOREIGN KEY constraint failed')
    }
  })

  test('team members default to the member role', async () => {
    await db
      .insert(team)
      .values({ id: 't-1', organizationId: 'org-a', name: 'Team', createdAt: now })
    const [row] = await db
      .insert(teamMember)
      .values({ id: 'tm-1', teamId: 't-1', userId: alice })
      .returning()
    expect(row.role).toBe('member')
  })
})

describe('running timer', () => {
  function running(id: string) {
    return withActor(alice, async () =>
      db.insert(timeEntry).values({ id, organizationId: 'org-a', userId: alice, startedAt: now }),
    )
  }

  test('a user has at most one running entry', async () => {
    await running('e-run-1')
    await expect(running('e-run-2')).rejects.toThrow()
  })

  test('a soft-deleted running entry no longer blocks a new one', async () => {
    await withActor(alice, async () =>
      db.update(timeEntry).set({ sysDeleted: true }).where(eq(timeEntry.id, 'e-run-1')),
    )
    await running('e-run-3')
  })

  test('an entry cannot stop before it started', async () => {
    await expect(
      withActor(alice, async () =>
        db.insert(timeEntry).values({
          id: 'e-backwards',
          organizationId: 'org-a',
          userId: bob,
          startedAt: now,
          stoppedAt: new Date(now.getTime() - 1),
        }),
      ),
    ).rejects.toThrow()
  })
})
