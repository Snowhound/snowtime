import { render, screen, waitFor } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setTransport } from '~/lib/api/client'
import { mockTransport } from '~/lib/api/testing'
import type { Member } from '~/lib/queries/members'
import type { Project } from '~/lib/queries/projects'
import { getLocale, overwriteGetLocale } from '~/paraglide/runtime.js'
import type { ReportInput } from '~/server/reports/reports.schemas'
import type { ReportEntries, Table } from './export'
import { ExportMenu } from './export-menu'
import type { Report } from './queries'

const HOUR = 3_600_000
const userId = '01900000-0000-7000-8000-000000000101'

const fn = vi.hoisted(() => ({
  getReportExport: vi.fn(),
  toXlsx: vi.fn(),
}))
setTransport(mockTransport(fn))
// The files themselves are export.test.ts's; here only the tables that go into them count.
vi.mock('./export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./export')>()),
  toXlsx: fn.toXlsx,
  downloadFile: vi.fn(),
}))

const members = [{ userId, name: 'Mari Tamm', email: 'mari@example.com' }] as Member[]
const projects: Project[] = []
const names = { userId, admin: false, projects, teams: [], members }
const uiLocale = getLocale

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
    trackedDays: 1,
    entries: 1,
    formerMembers: [],
    ...totals,
    projects: [{ projectId: null, ...totals }],
    tickets: [{ ticket: null, ...totals }],
    members: [{ userId, ...totals }],
    teams: [],
  }
}

function entries(ms: number): Pick<ReportEntries, 'entries'> {
  return {
    entries: [
      {
        userId,
        projectId: null,
        description: 'Timer layouts',
        ticket: null,
        date: '2026-09-24',
        from: new Date('2026-09-24T06:00:00Z'),
        running: true,
        ms,
      },
    ],
  }
}

// Each row's duration, in milliseconds: its last h:mm cell.
function durations(table: Table) {
  return table.rows.map(
    (row) =>
      (row.findLast((cell) => typeof cell === 'object' && cell !== null) as { ms: number }).ms,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fn.toXlsx.mockResolvedValue(new Blob())
})

afterEach(() => overwriteGetLocale(uiLocale))

const input = { from: '2026-09-24', to: '2026-09-25', unit: 'day' } as const

async function choose(
  item: RegExp,
  options: { group?: 'project' | 'member'; input?: ReportInput; onError?: () => void } = {},
) {
  render(() => (
    <ExportMenu
      report={report(HOUR)}
      group={options.group ?? 'project'}
      names={names}
      input={options.input ?? input}
      organizationId="org"
      organizationSlug="snowhound"
      onError={options.onError ?? (() => {})}
    />
  ))
  await userEvent.click(
    screen.getByRole('button', { name: /^(Export the report|Ekspordi aruanne)$/ }),
  )
  await userEvent.click(await screen.findByRole('menuitem', { name: item }))
}

async function exportXlsx(group: 'project' | 'member') {
  await choose(/Excel \(XLSX\)/, { group })
  await waitFor(() => expect(fn.toXlsx).toHaveBeenCalledOnce())
  return fn.toXlsx.mock.calls[0][0] as [
    { name: string; table: Table },
    { name: string; table: Table },
  ]
}

describe('ExportMenu', () => {
  test("the XLSX's timesheet and entries count a running timer up to the same moment", async () => {
    // The report on screen counted the timer up to one hour; it has run half an hour since.
    fn.getReportExport.mockResolvedValue({ report: report(1.5 * HOUR), ...entries(1.5 * HOUR) })
    const [list, timesheet] = await exportXlsx('project')
    const total = durations(timesheet.table).at(-1)
    expect(total).toBe(1.5 * HOUR)
    expect(durations(list.table).reduce((a, b) => a + b, 0)).toBe(total)
  })

  test('names the rows in English and without "(you)", whatever the UI language', async () => {
    overwriteGetLocale(() => 'et')
    fn.getReportExport.mockResolvedValue({ report: report(HOUR), ...entries(HOUR) })
    const [list, timesheet] = await exportXlsx('member')
    expect(timesheet.name).toBe('Timesheet')
    expect(timesheet.table.header[0]).toBe('Member')
    expect(timesheet.table.rows.map((row) => row[0])).toEqual(['Mari Tamm', 'Total'])
    expect(list.name).toBe('Entries')
    expect(list.table.header).toEqual([
      'Project',
      'Date',
      'Member',
      'Email',
      'Ticket',
      'Description',
      'Start',
      'End',
      'Duration',
      'Hours',
    ])
    expect(list.table.rows[0].slice(0, 4)).toEqual([
      'No project',
      '2026-09-24',
      'Mari Tamm',
      'mari@example.com',
    ])
    expect(list.table.rows[0].at(-1)).toBe(1)
  })

  test('loads a month at a time, the rest together after the first and counted up to its moment, and shows how far', async () => {
    const first = report(HOUR)
    let answer: (value: unknown) => void = () => {}
    fn.getReportExport
      .mockResolvedValueOnce({ report: first, entries: [] })
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
      .mockResolvedValueOnce(entries(HOUR))
    await choose(/Entries \(CSV\)/, {
      input: { from: '2026-07-15', to: '2026-09-25', unit: 'week' },
    })
    // The third month answers while the second still loads.
    expect(await screen.findByRole('button', { name: 'Exporting… 2/3' })).toBeDisabled()
    answer({ entries: [] })
    expect(await screen.findByRole('button', { name: 'Export the report' })).toBeEnabled()
    expect(fn.getReportExport.mock.calls.map(([input]) => input)).toEqual([
      { organizationId: 'org', report: expect.anything(), from: '2026-07-15', to: '2026-08-01' },
      {
        organizationId: 'org',
        report: expect.anything(),
        from: '2026-08-01',
        to: '2026-09-01',
        now: first.now,
      },
      {
        organizationId: 'org',
        report: expect.anything(),
        from: '2026-09-01',
        to: '2026-09-25',
        now: first.now,
      },
    ])
  })

  test('a failed piece fails the export', async () => {
    const onError = vi.fn()
    fn.getReportExport
      .mockResolvedValueOnce({ report: report(HOUR), entries: [] })
      .mockRejectedValueOnce(new Error('offline'))
    await choose(/Excel \(XLSX\)/, {
      input: { from: '2026-08-01', to: '2026-10-01', unit: 'week' },
      onError,
    })
    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith("The export didn't download. Try again."),
    )
    expect(fn.toXlsx).not.toHaveBeenCalled()
  })
})
