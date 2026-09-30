import { expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { timeEntry, userSettings } from '~/db/schema'
import { seedIds } from '~/db/seed'
import { countedSpan, daySplitter, startOfDay } from '~/lib/calendar'
import { as, createSeededDatabase, scopeOf } from '../testing'
import type { ReportEntriesInput } from './reports.schemas'
import { dayPage, getReportEntries, type ReportEntryPiece } from './reports.server'

test('SQL day windows match every reference page across busy days, cursors, and DST', async () => {
  const now = new Date('2026-10-26T09:00:00Z')
  const { db, cleanup } = await createSeededDatabase(now)
  try {
    const org = seedIds.orgs.northwind
    const scope = await scopeOf(db, seedIds.users.owner, org)
    await as(scope, async () => {
      await db
        .update(userSettings)
        .set({ timeZone: 'Europe/Tallinn' })
        .where(eq(userSettings.userId, scope.userId))
      await db.insert(timeEntry).values(
        Array.from({ length: 330 }, (_, i) => {
          const startedAt = new Date(i < 220 ? '2026-10-25T00:30:00Z' : '2026-10-22T20:30:00Z')
          return {
            id: `paging-${String(i).padStart(4, '0')}`,
            organizationId: org,
            userId: i % 2 ? seedIds.users.member : seedIds.users.owner,
            description: 'Window reference',
            startedAt,
            stoppedAt: new Date(startedAt.getTime() + 5 * 3_600_000),
          }
        }),
      )
      await db.insert(timeEntry).values({
        id: 'paging-future-stopped',
        organizationId: org,
        userId: scope.userId,
        startedAt: new Date('2026-10-28T10:00:00Z'),
        stoppedAt: new Date('2026-10-28T11:00:00Z'),
      })
    })
    const report = { from: '2026-10-01', to: '2026-11-01', unit: 'day' } as const
    const zone = 'Europe/Tallinn'
    const range = { from: startOfDay(report.from, zone), to: startOfDay(report.to, zone) }
    const split = daySplitter(report.from, report.to, zone)
    const entries = await db
      .select()
      .from(timeEntry)
      .where(and(eq(timeEntry.organizationId, org), eq(timeEntry.sysDeleted, false)))
    const pieces: ReportEntryPiece[] = []
    for (const entry of entries) {
      const span = countedSpan(entry, range, now.getTime())
      if (!span) continue
      let from = span.from
      for (const piece of split(span.from, span.to)) {
        const to = from + piece.ms
        pieces.push({
          entryId: entry.id,
          userId: entry.userId,
          projectId: entry.projectId,
          description: entry.description,
          ticket: entry.ticket,
          date: piece.date,
          startedAt: entry.startedAt,
          stoppedAt: entry.stoppedAt,
          from: new Date(from),
          to: new Date(to),
          ms: piece.ms,
          running: !entry.stoppedAt && to === now.getTime(),
        })
        from = to
      }
    }
    let after: ReportEntriesInput['after']
    let pages = 0
    do {
      const expected = dayPage(pieces, after)
      const actual = await getReportEntries(db, scope, { report, view: 'day', after }, now)
      expect(actual).toEqual({ view: 'day', ...expected })
      after = expected.next ?? undefined
      pages++
    } while (after)
    expect(pages).toBeGreaterThan(3)
  } finally {
    cleanup()
  }
})
