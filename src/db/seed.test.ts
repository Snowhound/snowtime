/// <reference types="bun" />
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { verifyPassword } from 'better-auth/crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '.'
import { account, project, timeEntry } from './schema'
import { SEED_PASSWORD, seed, seedIds } from './seed'
import { createTestDatabase } from './testing'

let db: Database
let cleanup: () => void

beforeAll(async () => {
  ;({ db, cleanup } = await createTestDatabase())
  await seed(db)
})

afterAll(() => cleanup())

test('seeded users sign in with the local password', async () => {
  const [row] = await db.select().from(account).where(eq(account.userId, seedIds.users.member))
  expect(row.providerId).toBe('credential')
  expect(await verifyPassword({ hash: row.password!, password: SEED_PASSWORD })).toBe(true)
})

test('exactly one running timer, and one entry crossing midnight UTC', async () => {
  const running = await db.select().from(timeEntry).where(isNull(timeEntry.stoppedAt))
  expect(running.map((e) => e.id)).toEqual([seedIds.entries.running])
  const overnight = await db.query.timeEntry.findFirst({ where: { id: seedIds.entries.overnight } })
  expect(overnight!.startedAt.getUTCDate()).not.toBe(overnight!.stoppedAt!.getUTCDate())
})

test('a few weeks of entries, with archived and deleted projects', async () => {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(timeEntry)
    .where(and(eq(timeEntry.organizationId, seedIds.orgs.northwind), eq(timeEntry.sysDeleted, false)))
  expect(count).toBeGreaterThan(200)
  const legacy = await db.query.project.findFirst({ where: { id: seedIds.projects.legacy } })
  expect(legacy!.archivedAt).not.toBeNull()
  const [scrapped] = await db.select().from(project).where(eq(project.id, seedIds.projects.scrapped))
  expect(scrapped.sysDeleted).toBe(true)
})
