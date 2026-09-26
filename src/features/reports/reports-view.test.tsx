import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { type JSX, createSignal } from 'solid-js'
import * as v from 'valibot'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, datesBetween, startOfWeek } from '~/lib/calendar'
import { newId } from '~/lib/queries/query'
import type { ReportEntriesInput, ReportInput } from '~/server/reports/reports.schemas'
import { ReportSearch } from './filters'
import { ReportsPage } from './reports-page'

// The server functions stay out of the DOM tests; getReport answers from `server.rows`,
// spread over the buckets of the range it is asked for.
const fn = vi.hoisted(() => ({
  getReport: vi.fn(),
  getReportEntries: vi.fn(),
  listTeams: vi.fn(),
  listMembers: vi.fn(),
  listProjects: vi.fn(),
  getAppSession: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('~/server/reports/reports.functions', () => ({
  getReport: fn.getReport,
  getReportEntries: fn.getReportEntries,
}))
vi.mock('~/server/teams/teams.functions', () => ({
  listTeams: fn.listTeams,
  listMembers: fn.listMembers,
}))
vi.mock('~/server/projects/projects.functions', () => ({ listProjects: fn.listProjects }))
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: fn.getAppSession }))
// The view renders without a router: navigating sets the search params the page reads.
vi.mock('@tanstack/solid-router', () => ({
  Link: (props: { to: string; hash?: string; class?: string; children: JSX.Element }) => (
    <a href={`${props.to}#${props.hash}`} class={props.class}>
      {props.children}
    </a>
  ),
  useNavigate: () => fn.navigate,
}))

const HOUR = 3_600_000
const organizationId = newId()

const me = newId()
const kadri = newId()
const mart = newId()
const liis = newId()

const platform = { id: newId(), name: 'Platform' }
const design = { id: newId(), name: 'Design' }

// Fresh objects for every call: Solid's stores keep their signals on the objects they wrap,
// so a fixture changed in place between tests would read stale.
function teams() {
  return [
    { ...design, members: [{ userId: mart, role: 'member' }] },
    {
      ...platform,
      members: [
        { userId: me, role: server.lead ? 'lead' : 'member' },
        { userId: kadri, role: 'member' },
      ],
    },
  ]
}

function person(userId: string, name: string) {
  const memberships = teams().flatMap((t) =>
    t.members.filter((m) => m.userId === userId).map((m) => ({ teamId: t.id, role: m.role })),
  )
  return { userId, name, email: '', image: null, orgRole: 'member', teams: memberships }
}

function team() {
  return platform.id
}

const snowtime = { id: newId(), name: 'Snowtime', color: '#3b82b8', archivedAt: null, teamIds: [] }

interface Row {
  kind: 'project' | 'member' | 'team'
  id: string | null
  // Milliseconds per bucket; missing buckets are empty.
  ms: number[]
}

interface Entry {
  userId: string
  projectId: string | null
  description: string
  // Its day and starting hour, UTC; each lasts an hour.
  date: string
  hour: number
}

const server: {
  role: 'member' | 'admin'
  lead: boolean
  rows: Row[]
  entries: Entry[]
} = {
  role: 'member',
  lead: false,
  rows: [],
  entries: [],
}

function bucketsOf(input: ReportInput) {
  if (input.unit === 'day') return datesBetween(input.from, input.to)
  const weeks = []
  for (let d = startOfWeek(input.from, 'mon'); d < input.to; d = addDays(d, 7)) weeks.push(d)
  return weeks
}

function totals(buckets: string[], ms: number[]) {
  const perBucket = buckets.map((_, i) => ms[i] ?? 0)
  return { total: perBucket.reduce((a, b) => a + b, 0), perBucket }
}

function report({ data }: { data: ReportInput }) {
  const buckets = bucketsOf(data)
  function rows(kind: Row['kind']) {
    return server.rows.filter((r) => r.kind === kind)
  }
  const projects = rows('project').map((r) => ({ projectId: r.id, ...totals(buckets, r.ms) }))
  return {
    ...totals(
      buckets,
      buckets.map((_, i) => projects.reduce((a, p) => a + p.perBucket[i], 0)),
    ),
    unit: data.unit,
    buckets,
    projects,
    members: rows('member').map((r) => ({ userId: r.id!, ...totals(buckets, r.ms) })),
    teams: rows('team').map((r) => ({ teamId: r.id!, ...totals(buckets, r.ms) })),
  }
}

// getReportEntries over `server.entries`: the range and row it is asked for, By day in one
// page or merged By description.
function entries(input: Omit<ReportEntriesInput, 'after'>) {
  const { from, to } = input.report
  const row = input.row
  const pieces = server.entries
    .filter((e) => e.date >= from && e.date < to)
    .filter(
      (e) =>
        !row ||
        (row.group === 'project' && (e.projectId ?? 'none') === row.id) ||
        (row.group === 'member' && e.userId === row.id),
    )
    .map((e, i) => {
      const start = new Date(`${e.date}T${String(e.hour).padStart(2, '0')}:00:00Z`)
      const end = new Date(start.getTime() + HOUR)
      return {
        ...e,
        entryId: String(i),
        from: start,
        to: end,
        startedAt: start,
        stoppedAt: end,
        running: false,
        ms: HOUR,
      }
    })
  const summary = { count: pieces.length, total: pieces.length * HOUR }
  if (input.view === 'description') {
    const rows = new Map<string, { projectId: string | null; description: string; n: number }>()
    for (const p of pieces) {
      const key = `${p.projectId}|${p.description}`
      const r = rows.get(key) ?? { projectId: p.projectId, description: p.description, n: 0 }
      r.n++
      rows.set(key, r)
    }
    return {
      ...summary,
      view: 'description',
      rows: [...rows.values()].map((r) => ({
        projectId: r.projectId,
        description: r.description,
        total: r.n * HOUR,
        entries: r.n,
        days: r.n,
        userIds: [me],
      })),
    }
  }
  const dates = [...new Set(pieces.map((p) => p.date))].toSorted((a, b) => b.localeCompare(a))
  return {
    ...summary,
    view: 'day',
    days: dates.map((date) => ({
      date,
      total: pieces.filter((p) => p.date === date).length * HOUR,
    })),
    pieces,
    next: null,
  }
}

function session() {
  return {
    activeOrganizationId: organizationId,
    user: { id: me },
    organizations: [{ id: organizationId, name: 'Snowhound', role: server.role }],
    settings: { timeZone: 'Europe/Tallinn', weekStart: 'mon' },
  }
}

// This week by default, whose four days the server's rows fill; the page's default is this
// month.
function renderView(initial: ReportSearch = { range: 'this-week' }) {
  const [search, setSearch] = createSignal<ReportSearch>(initial)
  fn.navigate.mockImplementation(async (options: { search: ReportSearch }) =>
    setSearch(options.search),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['session'], session())
  render(() => (
    <QueryClientProvider client={queryClient}>
      <ReportsPage organizationId={organizationId} search={search()} />
    </QueryClientProvider>
  ))
  return { search }
}

// The report's filters, without the organization every call names.
function lastInput(): ReportInput {
  const { organizationId: _, ...input } = fn.getReport.mock.lastCall![0].data
  return input
}

function options(select: HTMLElement) {
  return within(select)
    .getAllByRole('option')
    .map((o) => o.textContent)
}

// Thursday 24 September 2026, noon in Tallinn: this week is 21 to 27 September.
const NOW = new Date('2026-09-24T09:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  server.role = 'member'
  server.rows = [
    { kind: 'project', id: snowtime.id, ms: [2 * HOUR, 0, 3 * HOUR, 1.5 * HOUR] },
    { kind: 'project', id: null, ms: [0.5 * HOUR, 0, 0, 0.25 * HOUR] },
    { kind: 'member', id: me, ms: [2.5 * HOUR, 0, 3 * HOUR, 1.75 * HOUR] },
  ]
  server.entries = [
    {
      userId: me,
      projectId: snowtime.id,
      description: 'Timer layouts',
      date: '2026-09-21',
      hour: 7,
    },
    {
      userId: me,
      projectId: snowtime.id,
      description: 'Timer layouts',
      date: '2026-09-23',
      hour: 8,
    },
    { userId: me, projectId: null, description: '', date: '2026-09-23', hour: 12 },
  ]
  server.lead = false
  fn.getAppSession.mockImplementation(async () => session())
  fn.getReport.mockImplementation(async (input) => report(input))
  fn.getReportEntries.mockImplementation(async ({ data }) => entries(data))
  fn.listTeams.mockImplementation(async () => teams())
  fn.listMembers.mockImplementation(async () => [
    person(kadri, 'Kadri Tamm'),
    person(liis, 'Liis Mets'),
    person(me, 'Max Member'),
    person(mart, 'Mart Kask'),
  ])
  fn.listProjects.mockResolvedValue([snowtime])
})

afterEach(() => {
  vi.useRealTimers()
})

// The Entries card's count and total, whose text Solid splits into several nodes.
function summary(text: string) {
  return (_: string, element: Element | null) =>
    element?.tagName === 'SPAN' && element.textContent === text
}

// Types into a date field and leaves it, which commits the date.
function typeDate(label: string, value: string) {
  const input = screen.getByLabelText(label)
  fireEvent.input(input, { target: { value } })
  fireEvent.blur(input)
}

describe('ReportsView', () => {
  test('members see their own time by project, with row and column totals', async () => {
    renderView()
    const grid = await screen.findByRole('table')
    expect(lastInput()).toEqual({ from: '2026-09-21', to: '2026-09-28', unit: 'day' })
    expect(screen.queryByLabelText('People')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByText(/Your own time/)).toBeInTheDocument()
    expect(
      screen.getByText(/Days and weeks in Europe\/Tallinn, starting Monday/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'change' })).toHaveAttribute(
      'href',
      '/$org/settings#preferences',
    )
    expect(screen.getByText('Projects by day')).toBeInTheDocument()

    const rows = within(grid).getAllByRole('row')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Project'),
      'Snowtime2:00·3:001:30···6:30',
      'No project0:30··0:15···0:45',
      'Total2:30·3:001:45···7:15',
    ])
    // Thursday, today, is shaded.
    const today = within(rows[1]).getAllByRole('cell')[3]
    expect(today).toHaveTextContent('1:30')
    expect(today).toHaveClass('bg-muted/50')
    expect(within(rows[1]).getAllByRole('cell')[2]).not.toHaveClass('bg-muted/50')
  })

  test('team leads choose among their teams and those teams’ members', async () => {
    server.lead = true
    server.rows.push({ kind: 'team', id: platform.id, ms: [2.5 * HOUR] })
    renderView()
    await screen.findByRole('table')
    const people = await screen.findByLabelText('People')
    await waitFor(() =>
      expect(options(people)).toEqual(['Platform', 'Kadri Tamm', 'Max Member (you)']),
    )
    expect(screen.getByText(/the time of the Platform team, which you lead/)).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Project',
      'Team',
      'Member',
    ])

    await userEvent.selectOptions(people, 'Kadri Tamm')
    await waitFor(() => expect(lastInput()).toMatchObject({ userId: kadri }))
    await userEvent.click(screen.getByRole('tab', { name: 'Team' }))
    expect(await screen.findByText('Teams by day')).toBeInTheDocument()
    const grid = screen.getByRole('table')
    expect(within(grid).getByRole('rowheader', { name: 'Platform' })).toBeInTheDocument()
    // Leads get no "No team" row.
    expect(within(grid).queryByText('No team')).not.toBeInTheDocument()
  })

  test('a team outside the led teams is dropped, not sent', async () => {
    server.lead = true
    renderView({ range: 'this-week', team: design.id, group: 'team' })
    await waitFor(() => expect(fn.getReport).toHaveBeenCalled())
    expect(lastInput()).toEqual({ from: '2026-09-21', to: '2026-09-28', unit: 'day' })
  })

  test('admins choose everyone, each team and each member; no team shows as "No team"', async () => {
    server.role = 'admin'
    server.rows.push(
      { kind: 'member', id: liis, ms: [HOUR] },
      { kind: 'team', id: platform.id, ms: [2.5 * HOUR] },
    )
    renderView({ range: 'this-week', group: 'team' })
    const people = await screen.findByLabelText('People')
    await waitFor(() =>
      expect(options(people)).toEqual([
        'Everyone',
        'Design',
        'Platform',
        'Kadri Tamm',
        'Liis Mets',
        'Max Member (you)',
        'Mart Kask',
      ]),
    )
    expect(screen.getByText(/Everyone in the organization/)).toBeInTheDocument()
    expect(screen.getByText(/Teams count the time of their current members/)).toBeInTheDocument()
    const grid = await screen.findByRole('table')
    // Liis is in no team.
    expect(
      within(grid).getByRole('rowheader', { name: 'No team' }).closest('tr'),
    ).toHaveTextContent('No team1:00······1:00')

    await userEvent.selectOptions(people, 'Design')
    await waitFor(() => expect(lastInput()).toMatchObject({ teamId: design.id }))
    expect(lastInput()).not.toHaveProperty('userId')
  })

  test('presets and previous and next set the range', async () => {
    const { search } = renderView()
    await screen.findByRole('table')
    const preset = screen.getByLabelText('Range')

    await userEvent.selectOptions(preset, 'Last month')
    await waitFor(() =>
      expect(lastInput()).toEqual({ from: '2026-08-01', to: '2026-09-01', unit: 'day' }),
    )
    expect(search()).toEqual({ range: 'last-month' })

    await userEvent.click(screen.getByRole('button', { name: 'Previous range' }))
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-07-01', to: '2026-08-01' }))
    expect(search()).toEqual({ range: 'custom', from: '2026-07-01', to: '2026-07-31' })
    expect(preset).toHaveValue('custom')

    await userEvent.click(screen.getByRole('button', { name: 'Next range' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next range' }))
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-09-01', to: '2026-10-01' }))
    expect(preset).toHaveValue('this-month')
    expect(search()).toEqual({})

    await userEvent.selectOptions(preset, 'Last week')
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-09-14', to: '2026-09-21' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next range' }))
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-09-21', to: '2026-09-28' }))
    expect(search()).toEqual({ range: 'this-week' })

    await userEvent.selectOptions(preset, 'Today')
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-09-24', to: '2026-09-25' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous range' }))
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-09-23', to: '2026-09-24' }))
    expect(screen.getByLabelText('From')).toHaveValue('23.09.2026')
    expect(screen.getByLabelText('To')).toHaveValue('23.09.2026')
  })

  test('ranges over 35 days total per week', async () => {
    renderView()
    await screen.findByRole('table')
    typeDate('From', '2026-06-01')
    await waitFor(() =>
      expect(lastInput()).toEqual({ from: '2026-06-01', to: '2026-09-28', unit: 'week' }),
    )
    expect(await screen.findByText('Projects by week')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Day' })).toBeDisabled()

    // Back to 35 days, the unit is the user's again.
    typeDate('From', '2026-08-24')
    await waitFor(() =>
      expect(lastInput()).toEqual({ from: '2026-08-24', to: '2026-09-28', unit: 'day' }),
    )
    expect(screen.getByRole('button', { name: 'Day' })).toBeEnabled()
  })

  test('the To date may come before From, and a year and more is refused', async () => {
    renderView()
    await screen.findByRole('table')
    typeDate('To', '2026-09-10')
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-09-10', to: '2026-09-22' }))

    typeDate('From', '2024-01-01')
    expect(await screen.findByText('The range can span at most 371 days.')).toBeInTheDocument()
    expect(lastInput()).toMatchObject({ from: '2026-09-10' })
  })

  test('an empty range says so', async () => {
    server.rows = []
    renderView()
    expect(await screen.findByText('No time tracked in this range.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('bad or missing search params fall back to this month by project', async () => {
    expect(
      v.parse(ReportSearch, { range: 'someday', from: '2026-02-30', group: 'x', unit: 'hour' }),
    ).toEqual({})
    renderView({ range: 'custom', from: '2026-09-10' })
    await screen.findByRole('table')
    expect(lastInput()).toEqual({ from: '2026-09-01', to: '2026-10-01', unit: 'day' })
    expect(screen.getByLabelText('Range')).toHaveValue('this-month')
  })

  test('the Entries card lists a week by day, newest first, without a member column', async () => {
    renderView()
    const card = await screen.findByRole('region', { name: 'Entries' })
    expect(await within(card).findByText(summary('3 entries · 3:00'))).toBeInTheDocument()
    const headings = within(card).getAllByRole('heading', { level: 4 })
    expect(headings.map((h) => h.textContent)).toEqual([
      'Wednesday, September 232:00',
      'Monday, September 211:00',
    ])
    expect(within(card).getAllByRole('listitem').at(-1)).toHaveTextContent(
      /^Timer layouts1:0010:00 – 11:00Snowtime$/,
    )
    expect(within(card).getByText('No description')).toBeInTheDocument()
    expect(within(card).queryByText(/Max Member/)).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'By day' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('the Entries card waits for its own query, not the timesheet', async () => {
    let answer: (value: unknown) => void = () => {}
    fn.getReportEntries.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    renderView()
    await screen.findByRole('table')
    expect(screen.getByRole('status')).toHaveTextContent('Loading entries…')
    answer(entries(fn.getReportEntries.mock.lastCall![0].data))
    expect(await screen.findByText(summary('3 entries · 3:00'))).toBeInTheDocument()
  })

  test('a month opens By description, and the choice goes in the URL', async () => {
    const { search } = renderView({})
    const card = await screen.findByRole('region', { name: 'Entries' })
    expect(await within(card).findByText('2 entries on 2 days')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'By description' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(fn.getReportEntries.mock.lastCall![0].data).toMatchObject({ view: 'description' })

    await userEvent.click(within(card).getByRole('button', { name: 'By day' }))
    await waitFor(() => expect(search()).toEqual({ entries: 'day' }))
    expect(await within(card).findAllByRole('heading', { level: 4 })).toHaveLength(2)
  })

  test('a timesheet cell narrows the card to its row and day, and a chip clears it', async () => {
    const { search } = renderView()
    const grid = await screen.findByRole('table')
    const card = await screen.findByRole('region', { name: 'Entries' })
    const row = within(grid).getByRole('rowheader', { name: 'Snowtime' }).closest('tr')!
    const wednesday = within(row).getByRole('button', { name: '3:00' })
    await userEvent.click(wednesday)
    await waitFor(() =>
      expect(search()).toEqual({ range: 'this-week', row: snowtime.id, bucket: '2026-09-23' }),
    )
    expect(wednesday).toHaveAttribute('aria-pressed', 'true')
    expect(fn.getReportEntries.mock.lastCall![0].data).toMatchObject({
      report: { from: '2026-09-23', to: '2026-09-24' },
      row: { group: 'project', id: snowtime.id },
    })
    expect(await within(card).findByText(summary('1 entry · 1:00'))).toBeInTheDocument()
    expect(within(card).getByText('Snowtime · Wed, Sep 23')).toBeInTheDocument()

    // The Total row's cell narrows to the day alone, and choosing it again shows all.
    const totals = within(grid).getByRole('rowheader', { name: 'Total' }).closest('tr')!
    await userEvent.click(within(totals).getByRole('button', { name: '1:45' }))
    await waitFor(() => expect(search()).toEqual({ range: 'this-week', bucket: '2026-09-24' }))
    await userEvent.click(within(totals).getByRole('button', { name: '1:45' }))
    await waitFor(() => expect(search()).toEqual({ range: 'this-week' }))

    await userEvent.click(within(row).getByRole('button', { name: 'Snowtime' }))
    await waitFor(() => expect(search()).toEqual({ range: 'this-week', row: snowtime.id }))
    await userEvent.click(await within(card).findByRole('button', { name: 'Show all entries' }))
    await waitFor(() => expect(search()).toEqual({ range: 'this-week' }))
  })

  test('the Entries list closes from its title, stays closed, and a timesheet cell opens it', async () => {
    renderView()
    const card = await screen.findByRole('region', { name: 'Entries' })
    await within(card).findAllByRole('heading', { level: 4 })
    await userEvent.click(within(card).getByRole('button', { name: 'Entries' }))
    expect(within(card).getByRole('button', { name: 'Entries' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(within(card).queryByRole('heading', { level: 4 })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'By day' })).not.toBeInTheDocument()

    cleanup()
    renderView()
    const again = await screen.findByRole('region', { name: 'Entries' })
    expect(within(again).getByRole('button', { name: 'Entries' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    const grid = await screen.findByRole('table')
    const row = within(grid).getByRole('rowheader', { name: 'Snowtime' }).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: '3:00' }))
    expect(await within(again).findAllByRole('heading', { level: 4 })).toHaveLength(1)
    expect(within(again).getByRole('button', { name: 'Entries' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  test('changing a filter shows all entries in the view that fits the range', async () => {
    const { search } = renderView({
      range: 'this-week',
      row: snowtime.id,
      bucket: '2026-09-23',
      entries: 'description',
    })
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Next range' }))
    await waitFor(() =>
      expect(search()).toEqual({ range: 'custom', from: '2026-09-28', to: '2026-10-04' }),
    )
  })

  test('a row or day outside the report is ignored', async () => {
    server.lead = true
    renderView({ range: 'this-week', row: team(), bucket: '2026-10-01', group: 'member' })
    await screen.findByRole('table')
    await waitFor(() => expect(fn.getReportEntries).toHaveBeenCalled())
    expect(fn.getReportEntries.mock.lastCall![0].data).toMatchObject({
      report: { from: '2026-09-21', to: '2026-09-28' },
    })
    expect(fn.getReportEntries.mock.lastCall![0].data).not.toHaveProperty('row')
  })

  test('team leads see who tracked each entry, grouped by person within a day', async () => {
    server.lead = true
    server.entries.push({
      userId: kadri,
      projectId: snowtime.id,
      description: 'Review',
      date: '2026-09-23',
      hour: 13,
    })
    renderView()
    const card = await screen.findByRole('region', { name: 'Entries' })
    const wednesday = (await within(card).findAllByRole('heading', { level: 4 }))[0].closest('li')!
    expect(
      within(wednesday)
        .getAllByRole('listitem')
        .map((li) => within(li).queryByText(/Kadri|Max/)?.textContent),
    ).toEqual(['Kadri Tamm', 'Max Member (you)', 'Max Member (you)'])
  })
})
