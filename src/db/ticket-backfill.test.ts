/// <reference types="bun" />

// The time_entry_ticket migration moves the key at the start of existing descriptions into the
// ticket. Its SQL must agree with detectTicket, so this runs it on entries saved without a
// ticket and compares.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { detectTicket } from '~/lib/tickets'
import type { Database } from '.'
import { withActor } from './actor'
import { organization, timeEntry, user } from './schema'
import { createTestDatabase } from './testing'

let db: Database
let cleanup: () => Promise<void>

const backfill = readFileSync('drizzle/20260927054729_time_entry_ticket/migration.sql', 'utf8')
  .split('--> statement-breakpoint')
  .at(-1)!

const descriptions = [
  'NBW-412 Fix the login redirect',
  '[NBW-412] Fix the login redirect',
  'NBW-412: Fix the login redirect',
  'NBW-412 - Fix the login redirect',
  'NBW-412 | Fix the login redirect',
  'NBW-412|Fix the login redirect',
  'NBW-412, NBW-413 and more',
  'NBW-412 / review',
  'NBW-412 – review',
  '[NBW-412]: review',
  'NBW-412] review',
  '[NBW-412 review',
  'NBW-412',
  '[NBW-412]',
  'NBW-412 review',
  'ABCDEFGHIJ-1234567 longest',
  'ABCDEFGHIJK-1 too long a prefix',
  'AB-12345678 too long a number',
  'AB-0 zero',
  'AB-012 leading zero',
  'A-1 one letter',
  'ab-12 lowercase',
  'A_B-12 underscore',
  'NBW-412x no break',
  'NBW-412.5 no break',
  'NBW-412 -5 degrees',
  'UTF-8 import',
  'ISO-8601 dates',
  'SHA-256 sums',
  'COVID-19 leave',
  'Q3-2026 planning',
  'Pair with Erik on CP-91 flaky tests',
  'Fix the login redirect (NBW-412)',
  'https://acme.atlassian.net/browse/NBW-412 pasted link',
  '[] empty brackets',
  '',
  'Plain text',
]

beforeAll(async () => {
  ;({ db, cleanup } = await createTestDatabase())
  const now = new Date()
  await db
    .insert(user)
    .values({ id: 'u', name: 'U', email: 'u@example.com', createdAt: now, updatedAt: now })
  await db.insert(organization).values({ id: 'o', name: 'O', slug: 'o', createdAt: now })
  await withActor('u', async () =>
    db.insert(timeEntry).values(
      descriptions.map((description, i) => ({
        id: `e${i}`,
        organizationId: 'o',
        userId: 'u',
        description,
        startedAt: new Date(now.getTime() - (i + 2) * 3_600_000),
        stoppedAt: new Date(now.getTime() - (i + 1) * 3_600_000),
      })),
    ),
  )
  await db.run(sql.raw(backfill))
})

afterAll(() => cleanup())

test('moves the key at the start as detectTicket does, and leaves the rest', async () => {
  const rows = await db.select().from(timeEntry)
  const moved = new Map(rows.map((r) => [r.id, { description: r.description, ticket: r.ticket }]))
  descriptions.forEach((description, i) => {
    const detected = detectTicket(description, new Set(), null)
    // Only a key at the start leaves the text; links and later keys are not backfilled.
    const expected =
      !description.includes('://') && detected.description !== description
        ? detected
        : { description, ticket: null }
    expect({ text: description, ...moved.get(`e${i}`) }).toEqual({ text: description, ...expected })
  })
  expect(rows.filter((r) => r.ticket).length).toBeGreaterThan(10)
})

test('leaves an entry that has a ticket alone', async () => {
  await withActor('u', async () =>
    db.insert(timeEntry).values({
      id: 'kept',
      organizationId: 'o',
      userId: 'u',
      description: 'CP-1 review',
      ticket: 'NBW-9',
      startedAt: new Date(Date.now() - 3_600_000),
      stoppedAt: new Date(),
    }),
  )
  await db.run(sql.raw(backfill))
  const kept = await db.query.timeEntry.findFirst({ where: { id: 'kept' } })
  expect(kept).toMatchObject({ description: 'CP-1 review', ticket: 'NBW-9' })
})
