/// <reference types="bun" />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as v from 'valibot'
import type { Database } from '~/db'
import { member, teamMember, timeEntry } from '~/db/schema'
import { seedIds } from '~/db/seed'
import { addDays } from '~/lib/calendar'
import { listEntries } from '../entries/entries.server'
import type { Scope } from '../scope.server'
import { as, createSeededDatabase, scopeOf } from '../testing'
import {
  DESCRIPTION_PAGE_SIZE,
  ENTRY_PAGE_SIZE,
  type ReportEntriesInput,
  ReportExportInput,
  type ReportInput,
  type Report,
  type ReportEntryPiece,
} from './reports.schemas'
import {
  aggregate,
  breakdownOf,
  dayPage,
  getReport,
  getReportBreakdown,
  getReportEntries,
  getReportEntryTotals,
  getReportExport,
  mergeByDescription,
  type Aggregation,
} from './reports.server'

const { users: U, orgs: O, projects: P, teams: T } = seedIds
const HOUR = 3_600_000
const MINUTE = 60_000
// A Wednesday; the seed's running timer started 45 minutes before it.
const NOW = new Date('2026-09-23T12:00:00Z')

let db: Database
let cleanup: () => Promise<void>
const scopes: Record<keyof typeof U, Scope> = {} as never

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase(NOW))
  for (const [key, id] of Object.entries(U)) {
    scopes[key as keyof typeof U] = await scopeOf(db, id, O.northwind)
  }
})

afterAll(() => cleanup())

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0)
}
function ids<K extends string>(rows: Record<K, unknown>[], key: K) {
  return rows.map((r) => r[key]).sort()
}

// The export of a report within a month, as its one piece.
async function exportOf(scope: Scope, report: ReportInput) {
  const data = await getReportExport(db, scope, { report, from: report.from, to: report.to }, NOW)
  return { report: data.report!, entries: data.entries }
}

// Every breakdown of a report adds up to its total.
function expectConsistent(report: Report) {
  expect(sum(report.perBucket)).toBe(report.total)
  expect(sum(report.projects.map((p) => p.total))).toBe(report.total)
  expect(sum(report.members.map((m) => m.total))).toBe(report.total)
  for (const row of [...report.projects, ...report.members, ...report.teams]) {
    expect(row.perBucket).toHaveLength(report.buckets.length)
    expect(sum(row.perBucket)).toBe(row.total)
  }
}

function logFor(
  scope: Scope,
  startedAt: string,
  stoppedAt: string,
  projectId: string | null = P.internal,
) {
  return as(scope, async () => {
    await db.insert(timeEntry).values({
      id: uuidv7(),
      organizationId: O.northwind,
      userId: scope.userId,
      projectId,
      startedAt: new Date(startedAt),
      stoppedAt: new Date(stoppedAt),
    })
  })
}

describe('aggregate', () => {
  const base: Aggregation = {
    timeZone: 'Europe/Tallinn',
    weekStart: 'mon',
    unit: 'day',
    from: '2026-03-28',
    to: '2026-03-31',
    now: Date.parse('2026-03-30T09:00:00Z'),
    teams: [
      { teamId: 't1', userIds: ['a', 'b'] },
      { teamId: 't2', userIds: ['b', 'c'] },
    ],
    tickets: true,
  }
  function entry(
    userId: string,
    projectId: string | null,
    startedAt: string,
    stoppedAt: string | null,
  ) {
    return {
      userId,
      projectId,
      startedAt: new Date(startedAt),
      stoppedAt: stoppedAt ? new Date(stoppedAt) : null,
    }
  }

  test('splits at local midnights over a DST change and counts a running entry to now', () => {
    const report = aggregate(
      [
        // Saturday 23:00 to Sunday 05:00 Tallinn time, over the spring-forward night: 5 h.
        entry('a', 'p1', '2026-03-28T21:00:00Z', '2026-03-29T02:00:00Z'),
        // Running since Monday 10:00 Tallinn time, counted to 12:00.
        entry('b', null, '2026-03-30T07:00:00Z', null),
        // Before the range.
        entry('c', 'p1', '2026-03-27T10:00:00Z', '2026-03-27T11:00:00Z'),
      ],
      base,
    )
    expect(report.buckets).toEqual(['2026-03-28', '2026-03-29', '2026-03-30'])
    expect(report.perBucket).toEqual([1 * HOUR, 4 * HOUR, 2 * HOUR])
    expect(report.trackedDays).toBe(3)
    expect(report.projects).toEqual([
      { projectId: 'p1', total: 5 * HOUR, perBucket: [1 * HOUR, 4 * HOUR, 0] },
      { projectId: null, total: 2 * HOUR, perBucket: [0, 0, 2 * HOUR] },
    ])
    expect(report.members.map((m) => [m.userId, m.total])).toEqual([
      ['a', 5 * HOUR],
      ['b', 2 * HOUR],
    ])
    // b is in both teams; c has no time in the range.
    expect(report.teams.map((t) => [t.teamId, t.total])).toEqual([
      ['t1', 7 * HOUR],
      ['t2', 2 * HOUR],
    ])
  })

  test('week buckets start on the week start and count only days in the range', () => {
    const report = aggregate(
      [
        // Friday before the range, Sunday, and the next Tuesday.
        entry('a', 'p1', '2026-09-18T09:00:00Z', '2026-09-18T10:00:00Z'),
        entry('a', 'p1', '2026-09-20T09:00:00Z', '2026-09-20T10:00:00Z'),
        entry('a', 'p1', '2026-09-22T09:00:00Z', '2026-09-22T11:00:00Z'),
      ],
      {
        ...base,
        unit: 'week',
        from: '2026-09-19',
        to: '2026-09-24',
        now: Date.parse('2026-09-24T12:00:00Z'),
      },
    )
    expect(report.buckets).toEqual(['2026-09-14', '2026-09-21'])
    expect(report.perBucket).toEqual([1 * HOUR, 2 * HOUR])
    // Two weeks, but two days with time.
    expect(report.trackedDays).toBe(2)

    const sunday = aggregate([entry('a', 'p1', '2026-09-20T09:00:00Z', '2026-09-20T10:00:00Z')], {
      ...base,
      unit: 'week',
      weekStart: 'sun',
      from: '2026-09-19',
      to: '2026-09-24',
    })
    expect(sunday.buckets).toEqual(['2026-09-13', '2026-09-20'])
    expect(sunday.perBucket).toEqual([0, 1 * HOUR])
  })

  test('an empty range of entries has zero buckets and no rows', () => {
    expect(aggregate([], base)).toEqual({
      total: 0,
      perBucket: [0, 0, 0],
      buckets: ['2026-03-28', '2026-03-29', '2026-03-30'],
      trackedDays: 0,
      entries: 0,
      projects: [],
      tickets: [],
      members: [],
      teams: [],
    })
  })

  test('totals per ticket, with time without one in its own row', () => {
    const { tickets, total } = aggregate(
      [
        { ...entry('a', null, '2026-03-28T08:00:00Z', '2026-03-28T10:00:00Z'), ticket: 'NBW-1' },
        { ...entry('b', null, '2026-03-28T11:00:00Z', '2026-03-28T12:00:00Z'), ticket: 'NBW-1' },
        entry('a', null, '2026-03-29T08:00:00Z', '2026-03-29T08:30:00Z'),
      ],
      base,
    )
    expect(tickets.map((t) => [t.ticket, t.total])).toEqual([
      ['NBW-1', 3 * HOUR],
      [null, HOUR / 2],
    ])
    expect(sum(tickets.map((t) => t.total))).toBe(total)
    const entries = [entry('a', null, '2026-03-28T08:00:00Z', '2026-03-28T10:00:00Z')]
    expect(aggregate(entries, { ...base, tickets: false }).tickets).toEqual([])
  })

  test('counts each entry with time in the range once', () => {
    const report = aggregate(
      [
        entry('a', 'p1', '2026-03-28T20:00:00Z', '2026-03-29T02:00:00Z'),
        entry('a', 'p1', '2026-03-29T08:00:00Z', '2026-03-29T09:00:00Z'),
        entry('a', 'p1', '2026-03-20T08:00:00Z', '2026-03-20T09:00:00Z'),
      ],
      base,
    )
    expect(report.entries).toBe(2)
  })
})

describe('breakdownOf', () => {
  test('totals the range by project and member and by ticket and member', () => {
    const a = {
      timeZone: 'Europe/Tallinn',
      from: '2026-03-28',
      to: '2026-03-31',
      now: Date.parse('2026-03-30T09:00:00Z'),
      tickets: true,
    }
    function entry(userId: string, projectId: string | null, ticket: string | null, h: number) {
      const startedAt = new Date(`2026-03-${28 + h}T08:00:00Z`)
      return { userId, projectId, ticket, startedAt, stoppedAt: new Date(+startedAt + HOUR) }
    }
    const breakdown = breakdownOf(
      [
        entry('a', 'p1', 'NBW-1', 0),
        entry('a', 'p1', null, 1),
        entry('b', 'p1', 'NBW-1', 1),
        entry('b', null, 'NBW-1', 2),
        // Running since 11:00 Tallinn time, counted to 12:00, and one before the range.
        {
          ...entry('a', null, null, 2),
          startedAt: new Date('2026-03-30T08:00:00Z'),
          stoppedAt: null,
        },
        {
          ...entry('c', 'p1', null, 0),
          startedAt: new Date('2026-03-20T08:00:00Z'),
          stoppedAt: new Date('2026-03-20T09:00:00Z'),
        },
      ],
      a,
    )
    // Most time first, then by member.
    expect(breakdown.projects).toEqual([
      { projectId: 'p1', userId: 'a', total: 2 * HOUR },
      { projectId: null, userId: 'a', total: HOUR },
      { projectId: 'p1', userId: 'b', total: HOUR },
      { projectId: null, userId: 'b', total: HOUR },
    ])
    expect(breakdown.tickets).toEqual([
      { ticket: null, userId: 'a', total: 2 * HOUR },
      { ticket: 'NBW-1', userId: 'b', total: 2 * HOUR },
      { ticket: 'NBW-1', userId: 'a', total: HOUR },
    ])
  })
})

describe('getReport', () => {
  test("uses the user's zone and week start and counts the running timer up to now", async () => {
    const today = await getReport(
      db,
      scopes.member,
      { from: '2026-09-23', to: '2026-09-24', unit: 'day' },
      NOW,
    )
    expect(today).toMatchObject({
      timeZone: 'Europe/Tallinn',
      weekStart: 'mon',
      from: new Date('2026-09-22T21:00:00Z'),
      to: new Date('2026-09-23T21:00:00Z'),
      now: NOW,
      buckets: ['2026-09-23'],
      total: 45 * MINUTE,
      projects: [{ projectId: P.website, total: 45 * MINUTE }],
    })
    const later = new Date(NOW.getTime() + HOUR)
    const again = await getReport(
      db,
      scopes.member,
      { from: '2026-09-23', to: '2026-09-24', unit: 'day' },
      later,
    )
    expect(again.total).toBe(105 * MINUTE)
  })

  test('matches the entries listEntries returns, without deleted or other organizations’ entries', async () => {
    const range = { from: new Date('2026-09-21T21:00:00Z'), to: new Date('2026-09-22T21:00:00Z') }
    for (const scope of [scopes.engineer, scopes.member]) {
      const listed = await listEntries(db, scope, { ...range, userId: scope.userId })
      const expected = sum(listed.map((e) => e.stoppedAt!.getTime() - e.startedAt.getTime()))
      const report = await getReport(
        db,
        scope,
        { from: '2026-09-22', to: '2026-09-23', unit: 'day' },
        NOW,
      )
      expect(report.total).toBe(expected)
      expect(ids(report.projects, 'projectId')).not.toContain(P.audit)
    }
  })

  test('members see their own time, leads their teams’, admins everyone’s', async () => {
    const input = { from: '2026-09-14', to: '2026-09-21', unit: 'day' } as const
    const member = await getReport(db, scopes.member, input, NOW)
    expect(ids(member.members, 'userId')).toEqual([U.member])
    expect(member.teams).toEqual([])

    const lead = await getReport(db, scopes.lead, input, NOW)
    expect(ids(lead.members, 'userId')).toEqual([U.lead, U.member].sort())
    expect(ids(lead.teams, 'teamId')).toEqual([T.design])

    const engLead = await getReport(db, scopes.engLead, input, NOW)
    expect(ids(engLead.members, 'userId')).toEqual([U.member, U.engLead, U.engineer].sort())

    const admin = await getReport(db, scopes.admin, input, NOW)
    expect(ids(admin.members, 'userId')).toEqual(Object.values(U).sort())
    expect(ids(admin.teams, 'teamId')).toEqual([T.design, T.engineering].sort())
    for (const report of [member, lead, engLead, admin]) expectConsistent(report)
  })

  test('narrows to one readable member or to a team the user may report on', async () => {
    const input = { from: '2026-09-14', to: '2026-09-21', unit: 'day' } as const
    const all = await getReport(db, scopes.lead, input, NOW)
    const one = await getReport(db, scopes.lead, { ...input, userId: U.member }, NOW)
    expect(ids(one.members, 'userId')).toEqual([U.member])
    expect(one.total).toBe(all.members.find((m) => m.userId === U.member)!.total)

    const design = await getReport(db, scopes.admin, { ...input, teamId: T.design }, NOW)
    expect(ids(design.members, 'userId')).toEqual([U.lead, U.member].sort())
    expect(design.total).toBe(all.total)

    await expect(
      getReport(db, scopes.lead, { ...input, userId: U.engineer }, NOW),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      key: 'entries_forbidden',
    })
    for (const [scope, teamId] of [
      [scopes.lead, T.engineering],
      [scopes.member, T.design],
    ] as const) {
      await expect(getReport(db, scope, { ...input, teamId }, NOW)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        key: 'team_report_forbidden',
      })
    }
    await expect(
      getReport(db, scopes.admin, { ...input, teamId: T.delivery }, NOW),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  test('filters by project, or to time without one', async () => {
    const input = { from: '2026-09-14', to: '2026-09-24', unit: 'day' } as const
    const all = await getReport(db, scopes.admin, input, NOW)
    const website = all.projects.find((p) => p.projectId === P.website)
    expect(website?.total).toBeGreaterThan(0)
    const one = await getReport(db, scopes.admin, { ...input, projectId: P.website }, NOW)
    expect(one.total).toBe(website!.total)
    expect(one.projects.map((p) => p.projectId)).toEqual([P.website])
    expectConsistent(one)
    const none = await getReport(db, scopes.admin, { ...input, projectId: 'none' }, NOW)
    expect(none.total).toBe(all.projects.find((p) => p.projectId === null)?.total ?? 0)
    // A member sees only their own time on it.
    const member = await getReport(db, scopes.member, input, NOW)
    expect(
      (await getReport(db, scopes.member, { ...input, projectId: P.website }, NOW)).total,
    ).toBe(member.projects.find((p) => p.projectId === P.website)?.total ?? 0)
  })

  test('week totals equal the day totals of the same range', async () => {
    const input = { from: '2026-09-02', to: '2026-09-23' } as const
    const days = await getReport(db, scopes.owner, { ...input, unit: 'day' }, NOW)
    const weeks = await getReport(db, scopes.owner, { ...input, unit: 'week' }, NOW)
    expect(weeks.buckets).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'])
    expect(weeks.total).toBe(days.total)
    const byWeek = [0, 1, 2, 3].map((w) =>
      sum(days.perBucket.filter((_, i) => Math.floor((i + 2) / 7) === w)),
    )
    expect(weeks.perBucket).toEqual(byWeek)
    expect(weeks.trackedDays).toBe(days.perBucket.filter((ms) => ms > 0).length)
    expectConsistent(weeks)
  })

  test("an entry crossing the user's midnight splits into both days", async () => {
    // 23:00 to 02:00 in London.
    await logFor(scopes.loner, '2026-09-25T22:00:00Z', '2026-09-26T01:00:00Z')
    const report = await getReport(
      db,
      scopes.loner,
      { from: '2026-09-25', to: '2026-09-27', unit: 'day' },
      NOW,
    )
    expect(report.perBucket).toEqual([1 * HOUR, 2 * HOUR])
  })

  test('team totals follow current membership', async () => {
    const input = { from: '2026-09-14', to: '2026-09-21', unit: 'day' } as const
    const before = await getReport(db, scopes.admin, input, NOW)
    function totalOf(r: Report, userId: string) {
      return r.members.find((m) => m.userId === userId)!.total
    }
    function designOf(r: Report) {
      return r.teams.find((t) => t.teamId === T.design)!.total
    }
    expect(designOf(before)).toBe(totalOf(before, U.lead) + totalOf(before, U.member))

    await db
      .delete(teamMember)
      .where(and(eq(teamMember.teamId, T.design), eq(teamMember.userId, U.member)))
    const after = await getReport(db, scopes.admin, input, NOW)
    expect(designOf(after)).toBe(totalOf(after, U.lead))
    expect(after.total).toBe(before.total)
  })

  test('totals per ticket only when asked', async () => {
    const input = { from: '2026-09-14', to: '2026-09-24', unit: 'day' } as const
    const plain = await getReport(db, scopes.admin, input, NOW)
    const byTicket = await getReport(db, scopes.admin, { ...input, tickets: true }, NOW)
    expect(plain.tickets).toEqual([])
    expect(byTicket.tickets.length).toBeGreaterThan(0)
    expect(sum(byTicket.tickets.map((t) => t.total))).toBe(plain.total)
    expect({ ...byTicket, tickets: [] } as Report).toEqual(plain)
  })

  test('names the members who have left the organization, whose time still counts', async () => {
    const input = { from: '2026-09-14', to: '2026-09-24', unit: 'day' } as const
    expect((await getReport(db, scopes.admin, input, NOW)).formerMembers).toEqual([])
    const left = and(eq(member.userId, U.loner), eq(member.organizationId, O.northwind))
    const [row] = await db.select().from(member).where(left)
    await db.delete(member).where(left)
    try {
      const report = await getReport(db, scopes.admin, input, NOW)
      expect(ids(report.members, 'userId')).toContain(U.loner)
      expect(report.formerMembers).toEqual([
        { userId: U.loner, name: 'Noah Solo', email: 'noah@example.com' },
      ])
      const { report: exported } = await exportOf(scopes.admin, input)
      expect(exported.formerMembers).toEqual(report.formerMembers)
    } finally {
      await db.insert(member).values(row)
    }
  })

  test('names a member who has left only when they have time in the range', async () => {
    const empty = { from: '2026-01-05', to: '2026-01-12', unit: 'day' } as const
    const left = and(eq(member.userId, U.loner), eq(member.organizationId, O.northwind))
    const [row] = await db.select().from(member).where(left)
    await db.delete(member).where(left)
    try {
      const report = await getReport(db, scopes.admin, empty, NOW)
      expect(ids(report.members, 'userId')).not.toContain(U.loner)
      expect(report.formerMembers).toEqual([])
    } finally {
      await db.insert(member).values(row)
    }
  })
})

describe('getReportBreakdown', () => {
  const input = { from: '2026-09-14', to: '2026-09-24', unit: 'day' } as const

  // The pairs' totals per first-level row and per member.
  function totalsBy<T extends { total: number }>(rows: readonly T[], key: (r: T) => string | null) {
    const totals = new Map<string | null, number>()
    for (const r of rows) totals.set(key(r), (totals.get(key(r)) ?? 0) + r.total)
    return totals
  }

  test("adds up to the report's project, ticket, and member totals", async () => {
    for (const scope of [scopes.member, scopes.lead, scopes.admin]) {
      const report = await getReport(db, scope, { ...input, tickets: true }, NOW)
      const breakdown = await getReportBreakdown(db, scope, { ...input, tickets: true }, NOW)
      const byProject = totalsBy(breakdown.projects, (r) => r.projectId)
      expect(report.projects.map((p) => byProject.get(p.projectId))).toEqual(
        report.projects.map((p) => p.total),
      )
      const byTicket = totalsBy(breakdown.tickets, (r) => r.ticket)
      expect(report.tickets.map((t) => byTicket.get(t.ticket))).toEqual(
        report.tickets.map((t) => t.total),
      )
      for (const pairs of [breakdown.projects, breakdown.tickets] as {
        userId: string
        total: number
      }[][]) {
        const byMember = totalsBy(pairs, (r) => r.userId)
        expect(report.members.map((m) => byMember.get(m.userId))).toEqual(
          report.members.map((m) => m.total),
        )
      }
    }
  })

  test("follows getReport's rules", async () => {
    const member = await getReportBreakdown(db, scopes.member, input, NOW)
    expect(new Set(member.projects.map((r) => r.userId))).toEqual(new Set([U.member]))
    // Theo leads Engineering: Max and Mia.
    const lead = await getReportBreakdown(db, scopes.engLead, input, NOW)
    expect([...new Set(lead.projects.map((r) => r.userId))].sort()).toEqual(
      [U.engLead, U.engineer, U.member].sort(),
    )
    const one = await getReportBreakdown(db, scopes.admin, { ...input, projectId: P.website }, NOW)
    expect(one.projects.length).toBeGreaterThan(0)
    expect(one.projects.map((r) => r.projectId)).toEqual(one.projects.map(() => P.website))
    await expect(
      getReportBreakdown(db, scopes.engLead, { ...input, userId: U.loner }, NOW),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', key: 'entries_forbidden' })
    await expect(
      getReportBreakdown(db, scopes.member, { ...input, teamId: T.design }, NOW),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', key: 'team_report_forbidden' })
  })
})

describe('getReportExport', () => {
  const input = { from: '2026-09-14', to: '2026-09-24', unit: 'day' } as const

  test("adds up to the report's totals per member, day, and project, running timer included", async () => {
    for (const scope of [scopes.member, scopes.lead, scopes.admin]) {
      const { report, entries } = await exportOf(scope, input)
      expect(report).toEqual(await getReport(db, scope, input, NOW))
      expect(sum(entries.map((e) => e.ms))).toBe(report.total)
      for (const m of report.members) {
        expect(sum(entries.filter((e) => e.userId === m.userId).map((e) => e.ms))).toBe(m.total)
      }
      report.buckets.forEach((date, i) => {
        expect(sum(entries.filter((e) => e.date === date).map((e) => e.ms))).toBe(
          report.perBucket[i],
        )
      })
      for (const p of report.projects) {
        const ms = entries.filter((e) => e.projectId === p.projectId).map((e) => e.ms)
        expect(sum(ms)).toBe(p.total)
      }
    }
    const { entries } = await exportOf(scopes.admin, input)
    const running = entries.filter((e) => e.running)
    expect(running).toHaveLength(1)
    expect(running[0].from.getTime() + running[0].ms).toBe(NOW.getTime())
    // The export's rows leave out what only the Entries card shows.
    expect(Object.keys(entries[0]).sort()).toEqual(
      ['date', 'description', 'from', 'ms', 'projectId', 'running', 'ticket', 'userId'].sort(),
    )
    expect(entries.map((e) => e.from.getTime())).toEqual(
      entries.map((e) => e.from.getTime()).sort((a, b) => a - b),
    )
  })

  test('follows the report’s role rules', async () => {
    const member = await exportOf(scopes.member, input)
    expect([...new Set(member.entries.map((e) => e.userId))]).toEqual([U.member])
    await expect(exportOf(scopes.lead, { ...input, userId: U.engineer })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      key: 'entries_forbidden',
    })
    await expect(exportOf(scopes.member, { ...input, teamId: T.design })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      key: 'team_report_forbidden',
    })
  })

  test("splits an entry at the user's midnight into a piece per day", async () => {
    // 23:00 to 02:00 in London.
    await logFor(scopes.loner, '2026-10-02T22:00:00Z', '2026-10-03T01:00:00Z')
    const { report, entries } = await exportOf(scopes.loner, {
      from: '2026-10-02',
      to: '2026-10-04',
      unit: 'day',
    })
    expect(report.timeZone).toBe('Europe/London')
    expect(entries.map((e) => [e.date, e.from.toISOString(), e.ms])).toEqual([
      ['2026-10-02', '2026-10-02T22:00:00.000Z', HOUR],
      ['2026-10-03', '2026-10-02T23:00:00.000Z', 2 * HOUR],
    ])
  })

  test('comes in pieces that count a running entry up to the first piece’s moment', async () => {
    const report = { from: '2026-09-14', to: '2026-10-04', unit: 'day' } as const
    const first = await getReportExport(
      db,
      scopes.admin,
      { report, from: '2026-10-01', to: '2026-10-04' },
      NOW,
    )
    expect(first.report?.now).toEqual(NOW)
    // An hour later, the timer still running.
    const later = new Date(NOW.getTime() + HOUR)
    const rest = await getReportExport(
      db,
      scopes.admin,
      { report, from: '2026-09-14', to: '2026-10-01', now: NOW },
      later,
    )
    expect(rest.report).toBeUndefined()
    const entries = [...first.entries, ...rest.entries]
    expect(sum(entries.map((e) => e.ms))).toBe(first.report!.total)
    const running = entries.find((e) => e.running)!
    expect(running.from.getTime() + running.ms).toBe(NOW.getTime())

    // A moment ahead of the server's counts only up to the server's now.
    const ahead = await getReportExport(
      db,
      scopes.admin,
      { report, from: '2026-09-14', to: '2026-10-01', now: later },
      NOW,
    )
    expect(sum(ahead.entries.map((e) => e.ms))).toBe(sum(rest.entries.map((e) => e.ms)))
  })

  test('takes a piece of at most 31 days inside the report', () => {
    const report = { from: '2026-01-01', to: '2026-12-01' }
    function ok(from: string, to: string) {
      return v.safeParse(ReportExportInput, { report, from, to }).success
    }
    expect(ok('2026-03-01', '2026-04-01')).toBe(true)
    expect(ok('2025-12-01', '2026-01-01')).toBe(false)
    expect(ok('2026-11-15', '2026-12-15')).toBe(false)
    expect(ok('2026-03-01', '2026-04-02')).toBe(false)
  })
})

// A day piece of a stopped entry, for the pure grouping tests.
function piece(p: Partial<ReportEntryPiece> & { date: string; at: number }): ReportEntryPiece {
  const { at, ...rest } = p
  const from = new Date(`${p.date}T00:00:00Z`).getTime() + at * HOUR
  return {
    entryId: uuidv7(),
    userId: U.member,
    projectId: P.website,
    description: '',
    ticket: null,
    from: new Date(from),
    to: new Date(from + HOUR),
    startedAt: new Date(from),
    stoppedAt: new Date(from + HOUR),
    running: false,
    ms: HOUR,
    ...rest,
  }
}

// Every page of By day, in order.
function allPages(pieces: ReportEntryPiece[]) {
  const pages = [dayPage(pieces)]
  while (pages.at(-1)!.next) pages.push(dayPage(pieces, pages.at(-1)!.next!))
  return pages
}

describe('dayPage', () => {
  test("lists days newest first, each person's pieces together, newest first", () => {
    const a = piece({ date: '2026-09-21', at: 9 })
    const b = piece({ date: '2026-09-22', at: 9, userId: U.lead })
    const c = piece({ date: '2026-09-22', at: 8, userId: U.member })
    const d = piece({ date: '2026-09-22', at: 11, userId: U.member })
    const { days, pieces, next } = dayPage([a, b, c, d])
    const lena = [U.lead, U.member].sort()[0] === U.lead
    expect(pieces.map((p) => p.entryId)).toEqual(
      lena ? [b, d, c, a].map((p) => p.entryId) : [d, c, b, a].map((p) => p.entryId),
    )
    expect(days).toEqual([
      { date: '2026-09-22', total: 3 * HOUR },
      { date: '2026-09-21', total: HOUR },
    ])
    expect(next).toBeNull()
  })

  test('pages end with a whole day, and split a day only when it is longer than a page', () => {
    const perDay = 40
    const pieces = ['2026-09-21', '2026-09-22', '2026-09-23'].flatMap((date) =>
      Array.from({ length: perDay }, (_, i) => piece({ date, at: i * 0.1 })),
    )
    const pages = allPages(pieces)
    expect(pages.map((p) => p.days.map((d) => d.date))).toEqual([
      ['2026-09-23', '2026-09-22'],
      ['2026-09-21'],
    ])
    expect(pages.flatMap((p) => p.pieces)).toHaveLength(pieces.length)

    const long = Array.from({ length: ENTRY_PAGE_SIZE + 30 }, (_, i) =>
      piece({ date: '2026-09-21', at: i * 0.1 }),
    )
    const [first, second] = allPages([...long, piece({ date: '2026-09-20', at: 9 })])
    expect(first.pieces).toHaveLength(ENTRY_PAGE_SIZE)
    // The day's heading gives its whole time on both pages.
    expect(first.days).toEqual([{ date: '2026-09-21', total: long.length * HOUR }])
    expect(second.days.map((d) => d.date)).toEqual(['2026-09-21', '2026-09-20'])
    expect(second.days[0].total).toBe(long.length * HOUR)
  })

  test('the next page follows the last piece shown, so a new entry shifts nothing', () => {
    const pieces = Array.from({ length: ENTRY_PAGE_SIZE + 10 }, (_, i) =>
      piece({ date: '2026-09-21', at: i * 0.1 }),
    )
    const first = dayPage(pieces)
    const added = piece({ date: '2026-09-21', at: 23.9 })
    const second = dayPage([...pieces, added], first.next!)
    const shown = new Set(first.pieces.map((p) => p.entryId))
    expect(second.pieces.some((p) => shown.has(p.entryId))).toBe(false)
    expect(second.pieces).toHaveLength(10)
  })
})

describe('mergeByDescription', () => {
  test('merges entries with the same project and description, most time first', () => {
    const overnight = piece({ date: '2026-09-21', at: 23, description: 'Review' })
    const rows = mergeByDescription([
      overnight,
      { ...overnight, date: '2026-09-22', ms: 2 * HOUR },
      piece({ date: '2026-09-23', at: 9, description: 'Review', userId: U.lead }),
      piece({ date: '2026-09-23', at: 10, description: 'Review', projectId: null }),
      piece({ date: '2026-09-23', at: 11, description: 'review', ms: HOUR / 2 }),
    ])
    expect(rows.map((r) => [r.projectId, r.description, r.total, r.entries, r.days])).toEqual([
      [P.website, 'Review', 4 * HOUR, 2, 3],
      [null, 'Review', HOUR, 1, 1],
      [P.website, 'review', HOUR / 2, 1, 1],
    ])
    expect(rows[0].userIds.sort()).toEqual([U.lead, U.member].sort())
  })

  test('keeps work on different tickets apart', () => {
    const rows = mergeByDescription([
      piece({ date: '2026-09-23', at: 9, description: 'Review', ticket: 'NBW-1' }),
      piece({ date: '2026-09-23', at: 10, description: 'Review', ticket: 'NBW-2' }),
      piece({ date: '2026-09-23', at: 11, description: 'Review', ticket: 'NBW-1' }),
    ])
    expect(rows.map((r) => [r.ticket, r.total])).toEqual([
      ['NBW-1', 2 * HOUR],
      ['NBW-2', HOUR],
    ])
  })
})

describe('getReportEntries', () => {
  const report = { from: '2026-09-14', to: '2026-09-24', unit: 'day' } as const
  function entriesOf(scope: Scope, input: Partial<ReportEntriesInput> = {}) {
    return getReportEntries(db, scope, { report, view: 'day', ...input }, NOW)
  }

  // Every page of By day, as the card loads them.
  async function allDays(scope: Scope, input: Partial<ReportEntriesInput> = {}) {
    const pages = []
    let after: ReportEntriesInput['after']
    do {
      const page = await entriesOf(scope, { ...input, after })
      if (page.view !== 'day') throw new Error('By day')
      pages.push(page)
      after = page.next ?? undefined
    } while (after)
    return { ...pages[0], pieces: pages.flatMap((p) => p.pieces), pages }
  }

  // Every row of By description, as the card loads them.
  async function allRows(scope: Scope, input: Partial<ReportEntriesInput> = {}) {
    const first = await entriesOf(scope, { ...input, view: 'description' })
    if (first.view !== 'description') throw new Error('By description')
    if (first.next === null) return { first, rows: first.rows }
    const rest = await entriesOf(scope, { ...input, view: 'description', offset: first.next })
    if (rest.view !== 'description') throw new Error('By description')
    expect(rest.next).toBeNull()
    return { first, rows: [...first.rows, ...rest.rows] }
  }

  function totalsOf(scope: Scope, input: Partial<ReportEntriesInput> = {}) {
    return getReportEntryTotals(db, scope, { report, ...input }, NOW)
  }

  test('lists the pieces the export reads, in both views', async () => {
    for (const scope of [scopes.member, scopes.lead, scopes.admin]) {
      const exported = await exportOf(scope, report)
      const day = await allDays(scope)
      expect(day.pieces.map((p) => `${p.date} ${p.from.getTime()} ${p.ms}`).sort()).toEqual(
        exported.entries.map((e) => `${e.date} ${e.from.getTime()} ${e.ms}`).sort(),
      )
      expect(sum(day.pieces.map((p) => p.ms))).toBe(exported.report.total)
      expect(new Set(day.pieces.map((p) => p.entryId)).size).toBe(exported.report.entries)
      for (const page of day.pages) expect(page.pieces.length).toBeLessThanOrEqual(ENTRY_PAGE_SIZE)

      const { rows } = await allRows(scope)
      expect(sum(rows.map((r) => r.total))).toBe(exported.report.total)
      expect(await totalsOf(scope)).toEqual({
        count: exported.report.entries,
        total: exported.report.total,
      })
    }
    // The admin's list is longer than a page.
    expect((await allDays(scopes.admin)).pages.length).toBeGreaterThan(1)
  })

  test('By description sends its top rows first, then the rest', async () => {
    const { first, rows } = await allRows(scopes.admin)
    expect(rows.length).toBeGreaterThan(DESCRIPTION_PAGE_SIZE)
    expect(first.rows).toHaveLength(DESCRIPTION_PAGE_SIZE)
    expect(first.rowCount).toBe(rows.length)
    expect(rows.map((r) => r.total)).toEqual(rows.map((r) => r.total).sort((a, b) => b - a))
  })

  test("narrows to a timesheet row with the row's total", async () => {
    const all = await getReport(db, scopes.admin, report, NOW)
    const byTicket = await getReport(db, scopes.admin, { ...report, tickets: true }, NOW)
    for (const [group, rows] of [
      ['project', all.projects.map((r) => ({ id: r.projectId ?? 'none', total: r.total }))],
      ['member', all.members.map((r) => ({ id: r.userId, total: r.total }))],
      ['team', all.teams.map((r) => ({ id: r.teamId, total: r.total }))],
      ['ticket', byTicket.tickets.map((r) => ({ id: r.ticket ?? 'none', total: r.total }))],
    ] as const) {
      for (const { id, total } of rows) {
        const row = { group, id } as ReportEntriesInput['row']
        expect((await totalsOf(scopes.admin, { row })).total).toBe(total)
        const day = await allDays(scopes.admin, { row })
        expect(sum(day.pieces.map((p) => p.ms))).toBe(total)
      }
    }
    // Noah, the admin, and the owner are in no team.
    const inTeams = await db
      .select({ userId: teamMember.userId })
      .from(teamMember)
      .where(inArray(teamMember.teamId, [T.design, T.engineering]))
    const alone = all.members.filter((m) => !inTeams.some((t) => t.userId === m.userId))
    expect(alone.map((m) => m.userId)).toContain(U.loner)
    const none = await totalsOf(scopes.admin, { row: { group: 'team', id: 'none' } })
    expect(none.total).toBe(sum(alone.map((m) => m.total)))
  })

  test('a day of the timesheet narrows the range to it', async () => {
    const all = await getReport(db, scopes.admin, report, NOW)
    const i = all.perBucket.findIndex((ms) => ms > 0)
    const date = all.buckets[i]
    const narrowed = { report: { ...report, from: date, to: addDays(date, 1) } }
    expect((await totalsOf(scopes.admin, narrowed)).total).toBe(all.perBucket[i])
    const day = await entriesOf(scopes.admin, narrowed)
    if (day.view === 'day') expect(day.days.map((d) => d.date)).toEqual([date])
  })

  test("a lead sees only their teams' entries", async () => {
    // Theo leads Engineering: Max and Mia.
    const lead = await allDays(scopes.engLead)
    expect([...new Set(lead.pieces.map((p) => p.userId))].sort()).toEqual(
      [U.engLead, U.engineer, U.member].sort(),
    )
    // Noah is in no team, and Lena leads Design.
    const other = { row: { group: 'member', id: U.loner } } as const
    expect(await totalsOf(scopes.engLead, other)).toEqual({ count: 0, total: 0 })
    expect(await entriesOf(scopes.engLead, other)).toMatchObject({ pieces: [] })
    const design = { row: { group: 'team', id: T.design } } as const
    expect(await totalsOf(scopes.engLead, design)).toEqual({ count: 0, total: 0 })
    expect(await entriesOf(scopes.engLead, design)).toMatchObject({ pieces: [] })
    await expect(
      entriesOf(scopes.engLead, { report: { ...report, userId: U.loner } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', key: 'entries_forbidden' })
    await expect(
      entriesOf(scopes.member, { report: { ...report, teamId: T.design } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', key: 'team_report_forbidden' })
  })
})
