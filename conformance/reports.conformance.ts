// Reports on the contract (task 084), over HTTP, as timer.conformance.ts runs. The reads take
// the report's filters as a JSON body, so they are POSTs marked as reads. The admin is the Lumen
// Works owner and sees everyone's time; the member sees their own.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { COMPANY } from '../perf/lib/database'
import {
  type Caller,
  type CallName,
  caller,
  refused,
  send as sendTo,
  type ServerUnderTest,
  serverUnderTest,
} from './server'

let server: ServerUnderTest
let headers: { admin: Record<string, string>; member: Record<string, string> }
let admin: Caller

beforeAll(async () => {
  server = await serverUnderTest()
  headers = { admin: await server.as('admin'), member: await server.as('member') }
  admin = caller(server.url, headers.admin)
}, 120_000)
afterAll(() => server?.stop())

function send(name: CallName, input: unknown, as = headers.admin) {
  return sendTo(server.url, name, input, as)
}

const organizationId = COMPANY.id
// The week before the seed's moment, 2026-09-30.
const week = { from: '2026-09-21', to: '2026-09-28' }

describe('reports', () => {
  test('the week, a day at a time, as a read that needs no Origin', async () => {
    const { origin: _, ...noOrigin } = headers.admin
    const { status, body } = await send('getReport', { organizationId, ...week }, noOrigin)
    expect(status).toBe(200)
    const report = await admin('getReport', { organizationId, ...week })
    expect(body).toMatchObject({ unit: 'day', buckets: report.buckets })
    expect(report.buckets).toHaveLength(7)
    expect(report.from).toBeInstanceOf(Date)
    expect(report.total).toBeGreaterThan(0)
    expect(report.total).toBe(report.members.reduce((sum, m) => sum + m.total, 0))
  })

  test("a member can't report on someone else, or on a team they don't lead", async () => {
    const report = await admin('getReport', { organizationId, ...week })
    const userId = report.members.at(-1)!.userId
    expect(await send('getReport', { organizationId, ...week, userId }, headers.member)).toEqual({
      status: 403,
      body: refused('FORBIDDEN', 'entries_forbidden'),
    })
    const { teamId } = report.teams[0]
    expect(await send('getReport', { organizationId, ...week, teamId }, headers.member)).toEqual({
      status: 403,
      body: refused('FORBIDDEN', 'team_report_forbidden'),
    })
  })

  test('a range that ends before it starts is refused with a message', async () => {
    const { status, body } = await send('getReport', {
      organizationId,
      from: week.to,
      to: week.from,
    })
    expect(status).toBe(400)
    expect(body).toMatchObject({ error: { message: expect.any(String) } })
  })

  test('the breakdown totals per project and member', async () => {
    const report = await admin('getReport', { organizationId, ...week })
    const breakdown = await admin('getReportBreakdown', { organizationId, ...week })
    expect(breakdown.projects.reduce((sum, p) => sum + p.total, 0)).toBe(report.total)
    expect(breakdown.tickets).toEqual([])
  })

  test('the entries come a page at a time By day, after the last piece shown', async () => {
    const input = {
      organizationId,
      report: { ...week, unit: 'day' as const },
      view: 'day' as const,
    }
    const first = await admin('getReportEntries', input)
    if (first.view !== 'day') throw new Error('Not By day')
    expect(first.pieces[0].from).toBeInstanceOf(Date)
    expect(first.next).not.toBeNull()
    const second = await admin('getReportEntries', { ...input, after: first.next! })
    if (second.view !== 'day') throw new Error('Not By day')
    const ids = new Set(first.pieces.map((p) => `${p.entryId}${p.date}`))
    expect(second.pieces.some((p) => ids.has(`${p.entryId}${p.date}`))).toBe(false)
  })

  test("one row's count and total, and By description's rows", async () => {
    const report = await admin('getReport', { organizationId, ...week })
    const { projectId } = report.projects[0]
    const row = { group: 'project' as const, id: projectId ?? 'none' }
    const totals = await admin('getReportEntryTotals', { organizationId, report: week, row })
    expect(totals.total).toBe(report.projects[0].total)
    const rows = await admin('getReportEntries', {
      organizationId,
      report: week,
      view: 'description',
      row,
    })
    if (rows.view !== 'description') throw new Error('Not By description')
    expect(rows.rows.every((r) => r.projectId === projectId)).toBe(true)
  })

  test("the export's first piece brings the report, and the next counts up to its moment", async () => {
    const report = { ...week, unit: 'day' as const }
    const first = await admin('getReportExport', {
      organizationId,
      report,
      from: week.from,
      to: '2026-09-24',
    })
    expect(first.report?.total).toBeGreaterThan(0)
    const next = await admin('getReportExport', {
      organizationId,
      report,
      from: '2026-09-24',
      to: week.to,
      now: first.report!.now,
    })
    expect(next.report).toBeUndefined()
    const ms = [...first.entries, ...next.entries].reduce((sum, e) => sum + e.ms, 0)
    expect(ms).toBe(first.report!.total)
  })
})
