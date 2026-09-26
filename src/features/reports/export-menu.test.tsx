import { render, screen, waitFor } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Member } from '~/lib/members'
import type { Project } from '~/lib/projects'
import type { ReportEntries, Table } from './export'
import { ExportMenu } from './export-menu'
import type { Report } from './queries'
import { reportRows } from './rows'

const HOUR = 3_600_000
const userId = '01900000-0000-7000-8000-000000000101'

const fn = vi.hoisted(() => ({
  getReportExport: vi.fn(),
  toXlsx: vi.fn(),
}))
vi.mock('~/server/reports/reports.functions', () => ({ getReportExport: fn.getReportExport }))
// The files themselves are export.test.ts's; here only the tables that go into them count.
vi.mock('./export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./export')>()),
  toXlsx: fn.toXlsx,
  downloadFile: vi.fn(),
}))

const members = [{ userId, name: 'Mari Tamm' }] as Member[]
const projects: Project[] = []

// A report of one day in which a timer runs, counted up to `ms`.
function report(ms: number): Report {
  const totals = { total: ms, perBucket: [ms] }
  return {
    timeZone: 'Europe/Tallinn',
    weekStart: 'mon',
    unit: 'day',
    from: new Date('2026-09-23T21:00:00Z'),
    to: new Date('2026-09-24T21:00:00Z'),
    now: new Date(Date.parse('2026-09-24T06:00:00Z') + ms),
    buckets: ['2026-09-24'],
    ...totals,
    projects: [{ projectId: null, ...totals }],
    members: [{ userId, ...totals }],
    teams: [],
  }
}

function entries(ms: number): ReportEntries {
  const from = new Date('2026-09-24T06:00:00Z')
  return {
    timeZone: 'Europe/Tallinn',
    entries: [
      {
        entryId: '01900000-0000-7000-8000-000000000501',
        userId,
        projectId: null,
        description: 'Timer layouts',
        date: '2026-09-24',
        from,
        to: new Date(from.getTime() + ms),
        running: true,
        ms,
      },
    ],
  }
}

// The duration in a table's last column, in milliseconds.
function durations(table: Table) {
  return table.rows.map((row) => (row.at(-1) as { ms: number }).ms)
}

beforeEach(() => {
  vi.clearAllMocks()
  fn.toXlsx.mockResolvedValue(new Blob())
})

describe('ExportMenu', () => {
  test("the XLSX's timesheet and entries count a running timer up to the same moment", async () => {
    // The report on screen counted the timer up to one hour; it has run half an hour since.
    fn.getReportExport.mockResolvedValue({ report: report(1.5 * HOUR), ...entries(1.5 * HOUR) })
    const input = { from: '2026-09-24', to: '2026-09-25', unit: 'day' } as const
    render(() => (
      <ExportMenu
        report={report(HOUR)}
        rowsOf={(r) =>
          reportRows(r, 'project', { userId, admin: false, projects, teams: [], members })
        }
        group="project"
        input={input}
        organizationId="org"
        organizationSlug="snowhound"
        projects={projects}
        members={members}
        onError={() => {}}
      />
    ))

    await userEvent.click(screen.getByRole('button', { name: 'Export the report' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Excel \(XLSX\)/ }))
    await waitFor(() => expect(fn.toXlsx).toHaveBeenCalledOnce())

    const [[timesheet, list]] = fn.toXlsx.mock.calls[0] as [[{ table: Table }, { table: Table }]]
    const total = durations(timesheet.table).at(-1)
    expect(total).toBe(1.5 * HOUR)
    expect(durations(list.table).reduce((a, b) => a + b, 0)).toBe(total)
  })
})
