/// <reference types="bun" />

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '.'
import { member, project, timeEntry } from './schema'
import { seed } from './seed'
import { companyIds, seedCompany } from './seed-company'
import { createTestDatabase } from './testing'

let db: Database
let cleanup: () => void

beforeAll(async () => {
  ;({ db, cleanup } = await createTestDatabase())
  await seed(db)
  await seedCompany(db)
})

afterAll(() => cleanup())

const inCompany = eq(timeEntry.organizationId, companyIds.org)

test('a year of entries from 18 members and one former member', async () => {
  const [{ count, users, first }] = await db
    .select({
      count: sql<number>`count(*)`,
      users: sql<number>`count(distinct ${timeEntry.userId})`,
      first: sql<number>`min(${timeEntry.startedAt})`,
    })
    .from(timeEntry)
    .where(and(inCompany, eq(timeEntry.sysDeleted, false)))
  expect(count).toBeGreaterThan(15_000)
  expect(users).toBe(19)
  expect(Date.now() - first).toBeGreaterThan(360 * 86_400_000)
  const members = await db.select().from(member).where(eq(member.organizationId, companyIds.org))
  expect(members).toHaveLength(18)
})

test('three running timers, and no one logs two things at once', async () => {
  const running = await db
    .select()
    .from(timeEntry)
    .where(and(inCompany, isNull(timeEntry.stoppedAt)))
  expect(running).toHaveLength(3)
  // Each entry starts after the one before it, in start order, ends.
  const [{ overlaps }] = await db.all<{ overlaps: number }>(sql`
    SELECT count(*) AS overlaps FROM (
      SELECT started_at, lag(coalesce(stopped_at, 9e15))
        OVER (PARTITION BY user_id ORDER BY started_at) AS previous_end
      FROM time_entry WHERE organization_id = ${companyIds.org}
    ) WHERE started_at < previous_end`)
  expect(overlaps).toBe(0)
})

test('archived projects have no time after they were archived', async () => {
  const [{ late }] = await db
    .select({ late: sql<number>`count(*)` })
    .from(timeEntry)
    .innerJoin(project, eq(project.id, timeEntry.projectId))
    .where(and(inCompany, sql`${timeEntry.stoppedAt} > ${project.archivedAt}`))
  expect(late).toBe(0)
})
