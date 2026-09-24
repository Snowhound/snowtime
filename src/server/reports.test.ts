/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '../db'
import { teamMember, timeEntry } from '../db/schema'
import { seedIds } from '../db/seed'
import { listEntries } from './entries.server'
import { aggregate, getReport, type Aggregation, type Report } from './reports.server'
import type { Scope } from './scope.server'
import { as, createSeededDatabase, scopeOf } from './testing'

const { users: U, orgs: O, projects: P, teams: T } = seedIds
const HOUR = 3_600_000
const MINUTE = 60_000
// A Wednesday; the seed's running timer started 45 minutes before it.
const NOW = new Date('2026-09-23T12:00:00Z')

let db: Database
let cleanup: () => void
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
      projects: [],
      members: [],
      teams: [],
    })
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
})
