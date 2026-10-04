import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { type JSX, createSignal } from 'solid-js'
import * as v from 'valibot'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, datesBetween, startOfWeek } from '~/lib/calendar'
import { writeCookie } from '~/lib/cookies'
import { newId } from '~/lib/queries/query'
import type {
  ReportEntriesInput,
  ReportEntryTotalsInput,
  ReportInput,
} from '~/server/reports/reports.schemas'
import { ReportSearch } from './filters'
import { ReportsPage } from './reports-page'

// The backend stays out of the DOM tests; getReport answers from `server.rows`,
// spread over the buckets of the range it is asked for.
const fn = vi.hoisted(() => ({
  getReport: vi.fn(),
  getReportBreakdown: vi.fn(),
  getReportEntries: vi.fn(),
  getReportEntryTotals: vi.fn(),
  listTeams: vi.fn(),
  listMembers: vi.fn(),
  listProjects: vi.fn(),
  getAppSession: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('~/lib/api/auth', () => fn)
vi.mock('~/lib/api/projects', () => fn)
vi.mock('~/lib/api/reports', () => fn)
vi.mock('~/lib/api/teams', () => fn)
// The view renders without a router: navigating sets the search params the page reads.
vi.mock('@tanstack/solid-router', () => ({
  Link: (props: { to: string; hash?: string; class?: string; children: JSX.Element }) => (
    <a href={`${props.to}#${props.hash}`} class={props.class}>
      {props.children}
    </a>
  ),
  useNavigate: () => fn.navigate,
}))
// The cookies module reads the request context only on the server.
vi.mock('@tanstack/solid-start', () => ({ getGlobalStartContext: () => undefined }))

function clearEntryFlags() {
  writeCookie('snowtime.reportEntriesNarrowed', null)
  writeCookie('snowtime.reportEntriesOpen', null)
}

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
  kind: 'project' | 'member' | 'team' | 'ticket'
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
  former: { userId: string; name: string; email: string }[]
} = {
  role: 'member',
  lead: false,
  rows: [],
  entries: [],
  former: [],
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

function report(input: ReportInput) {
  const buckets = bucketsOf(input)
  function rows(kind: Row['kind']) {
    return server.rows.filter((r) => r.kind === kind)
  }
  const projects = rows('project').map((r) => ({ projectId: r.id, ...totals(buckets, r.ms) }))
  const all = totals(
    buckets,
    buckets.map((_, i) => projects.reduce((a, p) => a + p.perBucket[i], 0)),
  )
  return {
    ...all,
    unit: input.unit,
    buckets,
    trackedDays: all.perBucket.filter((ms) => ms > 0).length,
    entries: server.entries.filter((e) => e.date >= input.from && e.date < input.to).length,
    projects,
    tickets: rows('ticket').map((r) => ({ ticket: r.id, ...totals(buckets, r.ms) })),
    members: rows('member').map((r) => ({ userId: r.id!, ...totals(buckets, r.ms) })),
    teams: rows('team').map((r) => ({ teamId: r.id!, ...totals(buckets, r.ms) })),
    formerMembers: server.former,
  }
}

// The entries of `server.entries` in the range and row asked for.
function piecesOf(input: ReportEntryTotalsInput) {
  const { from, to } = input.report
  const row = input.row
  return server.entries
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
        ticket: null,
        from: start,
        to: end,
        startedAt: start,
        stoppedAt: end,
        running: false,
        ms: HOUR,
      }
    })
}

function entryTotals(input: ReportEntryTotalsInput) {
  const pieces = piecesOf(input)
  return { count: pieces.length, total: pieces.length * HOUR }
}

// getReportEntries over `server.entries`: By day in one page, or merged By description.
function entries(input: Omit<ReportEntriesInput, 'after'>) {
  const pieces = piecesOf(input)
  if (input.view === 'description') {
    const rows = new Map<string, { projectId: string | null; description: string; n: number }>()
    for (const p of pieces) {
      const key = `${p.projectId}|${p.description}`
      const r = rows.get(key) ?? { projectId: p.projectId, description: p.description, n: 0 }
      r.n++
      rows.set(key, r)
    }
    const all = [...rows.values()]
    return {
      view: 'description',
      rowCount: all.length,
      next: null,
      rows: all.map((r) => ({
        projectId: r.projectId,
        ticket: null,
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
  const { organizationId: _, ...input } = fn.getReport.mock.lastCall![0]
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
  clearEntryFlags()
  // The Entries list starts closed until the user opens it; most tests need it open.
  writeCookie('snowtime.reportEntriesOpen', '1')
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
  server.former = []
  fn.getAppSession.mockImplementation(async () => session())
  fn.getReport.mockImplementation(async (input) => report(input))
  fn.getReportEntries.mockImplementation(async (data) => entries(data))
  fn.getReportEntryTotals.mockImplementation(async (data) => entryTotals(data))
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
  test('groups by ticket', async () => {
    server.rows.push(
      { kind: 'ticket', id: 'NBW-412', ms: [2 * HOUR] },
      { kind: 'ticket', id: null, ms: [HOUR] },
    )
    renderView()
    await screen.findByRole('table')

    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'Ticket')
    expect(await screen.findByText('Tickets by day')).toBeInTheDocument()
    const grid = screen.getByRole('table')
    expect(within(grid).getByRole('rowheader', { name: 'NBW-412' })).toBeInTheDocument()
    expect(within(grid).getByRole('rowheader', { name: 'No ticket' })).toBeInTheDocument()
  })

  test('filters to one project, time without one, or archived projects', async () => {
    const archived = { ...snowtime, id: newId(), name: 'Website 2025', archivedAt: new Date() }
    fn.listProjects.mockResolvedValue([snowtime, archived])
    const { search } = renderView()
    await screen.findByRole('table')

    const select = screen.getByLabelText('Project')
    expect(options(select)).toEqual(['All projects', 'No project', 'Snowtime', 'Website 2025'])
    expect(within(select).getByRole('group', { name: 'Archived' })).toHaveTextContent(
      'Website 2025',
    )
    await userEvent.selectOptions(select, 'Snowtime')
    await waitFor(() => expect(lastInput()).toMatchObject({ projectId: snowtime.id }))
    expect(search()).toMatchObject({ project: snowtime.id })

    await userEvent.selectOptions(screen.getByLabelText('Project'), 'No project')
    await waitFor(() => expect(lastInput()).toMatchObject({ projectId: 'none' }))

    await userEvent.selectOptions(screen.getByLabelText('Project'), 'All projects')
    await waitFor(() => expect(lastInput()).not.toHaveProperty('projectId'))
  })

  test('members see their own time by project, with row and column totals', async () => {
    renderView()
    const grid = await screen.findByRole('table')
    expect(lastInput()).toEqual({ from: '2026-09-21', to: '2026-09-28', unit: 'day' })
    expect(screen.queryByLabelText('People')).not.toBeInTheDocument()
    expect(options(screen.getByLabelText('Group by'))).toEqual(['Project', 'Ticket'])
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
    expect(options(screen.getByLabelText('Group by'))).toEqual([
      'Project',
      'Ticket',
      'Team',
      'Member',
    ])

    await userEvent.selectOptions(people, 'Kadri Tamm')
    await waitFor(() => expect(lastInput()).toMatchObject({ userId: kadri }))
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'Team')
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

  test('a member who has left the organization keeps their name, from the report', async () => {
    server.role = 'admin'
    const gone = newId()
    server.rows.push({ kind: 'member', id: gone, ms: [HOUR] })
    server.former = [{ userId: gone, name: 'Endel Endine', email: 'endel@example.com' }]
    renderView({ range: 'this-week', group: 'member' })
    const grid = await screen.findByRole('table')
    expect(within(grid).getByRole('rowheader', { name: 'Endel Endine' })).toBeInTheDocument()
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

  test('narrow windows show From and To for a custom range', async () => {
    const { search } = renderView()
    await screen.findByRole('table')
    const preset = screen.getByLabelText('Range')
    function dates() {
      return screen.getByText('From', { selector: 'label' }).parentElement!.parentElement!
    }
    expect(dates()).toHaveClass('hidden', 'xl:flex')

    await userEvent.selectOptions(preset, 'Custom')
    await waitFor(() => expect(search()).toMatchObject({ range: 'custom' }))
    expect(dates()).not.toHaveClass('hidden')

    // Dates that land on a preset keep the fields.
    typeDate('From', '2026-09-14')
    await waitFor(() => expect(search()).toMatchObject({ from: '2026-09-14' }))
    typeDate('To', '2026-09-20')
    await waitFor(() => expect(search()).toEqual({ range: 'last-week' }))
    expect(dates()).not.toHaveClass('hidden')

    await userEvent.selectOptions(preset, 'Today')
    await waitFor(() => expect(search()).toEqual({ range: 'today' }))
    expect(dates()).toHaveClass('hidden')
  })

  test('a custom range in the URL shows From and To', async () => {
    renderView({ range: 'custom', from: '2026-09-02', to: '2026-09-09' })
    await screen.findByRole('table')
    expect(
      screen.getByText('From', { selector: 'label' }).parentElement!.parentElement,
    ).not.toHaveClass('hidden')
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

  test('a slow report dims the last one after a moment, until it lands', async () => {
    renderView()
    const views = (await screen.findByRole('table')).closest('[aria-busy]')!
    let answer: (value: unknown) => void = () => {}
    fn.getReport.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
    fireEvent.click(screen.getByRole('button', { name: 'Next range' }))
    await vi.advanceTimersByTimeAsync(150)
    expect(lastInput()).toMatchObject({ from: '2026-09-28' })
    expect(views).toHaveAttribute('aria-busy', 'false')
    await vi.advanceTimersByTimeAsync(100)
    expect(views).toHaveAttribute('aria-busy', 'true')
    expect(views).toHaveClass('opacity-60')

    answer(report(fn.getReport.mock.lastCall![0]))
    await vi.advanceTimersByTimeAsync(0)
    expect(views).toHaveAttribute('aria-busy', 'false')
    expect(views).not.toHaveClass('opacity-60')
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
    expect(await within(card).findByText(summary('3 entries · 7:15'))).toBeInTheDocument()
    const headings = await within(card).findAllByRole('heading', { level: 4 })
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

  test("the Entries card's list waits for its own query, and its count comes with the report", async () => {
    let answer: (value: unknown) => void = () => {}
    fn.getReportEntries.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    renderView()
    await screen.findByRole('table')
    expect(screen.getByRole('status')).toHaveTextContent('Loading entries…')
    expect(screen.getByText(summary('3 entries · 7:15'))).toBeInTheDocument()
    answer(entries(fn.getReportEntries.mock.lastCall![0]))
    expect(await screen.findAllByRole('heading', { level: 4 })).toHaveLength(2)
    expect(fn.getReportEntryTotals).not.toHaveBeenCalled()
  })

  test('a month opens By description, and the choice goes in the URL', async () => {
    const { search } = renderView({})
    const card = await screen.findByRole('region', { name: 'Entries' })
    expect(await within(card).findByText('2 entries on 2 days')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'By description' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(fn.getReportEntries.mock.lastCall![0]).toMatchObject({ view: 'description' })

    await userEvent.click(within(card).getByRole('button', { name: 'By day' }))
    await waitFor(() => expect(search()).toEqual({ entries: 'day' }))
    expect(await within(card).findAllByRole('heading', { level: 4 })).toHaveLength(2)
  })

  test('By description shows its top rows, and Show all loads the rest', async () => {
    server.entries = ['Alpha', 'Beta', 'Gamma'].map((description, i) => ({
      userId: me,
      projectId: snowtime.id,
      description,
      date: `2026-09-0${i + 1}`,
      hour: 9,
    }))
    // The server's first page has the top two rows here.
    fn.getReportEntries.mockImplementation(async (data) => {
      const all = entries(data) as { rows: unknown[] }
      const offset = data.offset ?? 0
      const end = offset === 0 ? 2 : all.rows.length
      return { ...all, rows: all.rows.slice(offset, end), next: end < all.rows.length ? end : null }
    })
    renderView({})
    const card = await screen.findByRole('region', { name: 'Entries' })
    expect(await within(card).findByText('Beta')).toBeInTheDocument()
    expect(within(card).queryByText('Gamma')).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Show all 3' }))
    expect(await within(card).findByText('Gamma')).toBeInTheDocument()
    expect(within(card).getByText('Alpha')).toBeInTheDocument()
    expect(fn.getReportEntries.mock.lastCall![0]).toMatchObject({ offset: 2 })
    expect(within(card).queryByRole('button', { name: 'Show all 3' })).not.toBeInTheDocument()
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
    expect(fn.getReportEntries.mock.lastCall![0]).toMatchObject({
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

    // The row's total, in the last column, narrows to the row alone.
    const rowTotal = within(row).getAllByRole('button').at(-1)!
    await userEvent.click(rowTotal)
    await waitFor(() => expect(search()).toEqual({ range: 'this-week', row: snowtime.id }))
    await userEvent.click(rowTotal)
    await waitFor(() => expect(search()).toEqual({ range: 'this-week' }))

    await userEvent.click(within(row).getByRole('button', { name: 'Snowtime' }))
    await waitFor(() => expect(search()).toEqual({ range: 'this-week', row: snowtime.id }))
    await userEvent.click(await within(card).findByRole('button', { name: 'Show all entries' }))
    await waitFor(() => expect(search()).toEqual({ range: 'this-week' }))
  })

  test('the Entries list starts closed, opens from its title, stays as left, and a timesheet cell opens it', async () => {
    clearEntryFlags()
    renderView()
    const card = await screen.findByRole('region', { name: 'Entries' })
    const title = within(card).getByRole('button', { name: 'Entries' })
    expect(title).toHaveAttribute('aria-expanded', 'false')
    expect(await within(card).findByText(summary('3 entries · 7:15'))).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'By day' })).not.toBeInTheDocument()
    // A closed list isn't loaded.
    expect(fn.getReportEntries).not.toHaveBeenCalled()

    await userEvent.click(title)
    expect(title).toHaveAttribute('aria-expanded', 'true')
    expect(await within(card).findAllByRole('heading', { level: 4 })).toHaveLength(2)
    cleanup()
    renderView()
    const opened = await screen.findByRole('region', { name: 'Entries' })
    expect(await within(opened).findAllByRole('heading', { level: 4 })).toHaveLength(2)

    await userEvent.click(within(opened).getByRole('button', { name: 'Entries' }))
    cleanup()
    renderView()
    const closed = await screen.findByRole('region', { name: 'Entries' })
    expect(within(closed).getByRole('button', { name: 'Entries' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    const grid = await screen.findByRole('table')
    const row = within(grid).getByRole('rowheader', { name: 'Snowtime' }).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: '3:00' }))
    expect(await within(closed).findAllByRole('heading', { level: 4 })).toHaveLength(1)
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
    expect(fn.getReportEntries.mock.lastCall![0]).toMatchObject({
      report: { from: '2026-09-21', to: '2026-09-28' },
    })
    expect(fn.getReportEntries.mock.lastCall![0]).not.toHaveProperty('row')
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

  test('the view is a search param, and switching views clears the narrowing', async () => {
    const { search } = renderView({
      range: 'this-week',
      row: snowtime.id,
      bucket: '2026-09-23',
      entries: 'description',
    })
    await screen.findByRole('table')
    expect(screen.getByRole('tab', { name: 'Timesheet' })).toHaveAttribute('aria-selected', 'true')
    expect(v.parse(ReportSearch, { view: 'timesheet' })).toEqual({})

    await userEvent.click(screen.getByRole('tab', { name: 'Summary' }))
    await waitFor(() => expect(search()).toEqual({ range: 'this-week', view: 'summary' }))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // Export stays in the tab row.
    expect(screen.getByRole('button', { name: 'Export the report' })).toBeInTheDocument()

    // A filter change keeps the view.
    await userEvent.click(screen.getByRole('button', { name: 'Next range' }))
    await waitFor(() =>
      expect(search()).toEqual({
        range: 'custom',
        from: '2026-09-28',
        to: '2026-10-04',
        view: 'summary',
      }),
    )

    // Breakdown totals the range, so Totals per is disabled on it.
    await userEvent.click(screen.getByRole('tab', { name: 'Breakdown' }))
    await waitFor(() => expect(search()).toMatchObject({ view: 'breakdown' }))
    expect(screen.getByRole('button', { name: 'Day' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Week' })).toBeDisabled()

    await userEvent.click(screen.getByRole('tab', { name: 'Timesheet' }))
    await waitFor(() => expect(search()).not.toHaveProperty('view'))
    expect(screen.getByRole('button', { name: 'Week' })).toBeEnabled()
  })

  test('Summary totals the range, and a column or a row’s total narrows the Entries card', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
    const { search } = renderView({ range: 'this-week', view: 'summary' })
    expect(await screen.findByText('Time per day')).toBeInTheDocument()
    const stats = screen.getByText(/a day, over/).parentElement!
    expect(stats).toHaveTextContent(
      'Total 7:15·Average 2:25 a day, over 3 of 4 days·Top projectSnowtime90%',
    )

    const wednesday = screen.getByRole('button', { name: 'Entries for Wed, Sep 23, 3:00' })
    await userEvent.click(wednesday)
    await waitFor(() =>
      expect(search()).toEqual({ range: 'this-week', view: 'summary', bucket: '2026-09-23' }),
    )
    expect(wednesday).toHaveAttribute('aria-pressed', 'true')
    expect(fn.getReportEntries.mock.lastCall![0]).toMatchObject({
      report: { from: '2026-09-23', to: '2026-09-24' },
    })
    expect(fn.getReportEntries.mock.lastCall![0]).not.toHaveProperty('row')

    const snowtimeRow = screen.getByTitle('Snowtime').closest('li')!
    await userEvent.click(within(snowtimeRow).getByRole('button', { name: '6:30' }))
    await waitFor(() =>
      expect(search()).toEqual({ range: 'this-week', view: 'summary', row: snowtime.id }),
    )
    const card = screen.getByRole('region', { name: 'Entries' })
    expect(await within(card).findByText(summary('2 entries · 2:00'))).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Table' }))
    const table = await screen.findByRole('table')
    expect(
      within(table)
        .getAllByRole('row')
        .map((r) => r.textContent)
        .slice(0, 2),
    ).toEqual(['DaySnowtimeNo projectTotal', 'Mon, Sep 212:000:302:30'])
    vi.restoreAllMocks()
  })

  test('Breakdown splits rows by member, and a top-level total narrows the Entries card', async () => {
    server.role = 'admin'
    fn.getReportBreakdown.mockResolvedValue({
      projects: [
        { projectId: snowtime.id, userId: me, total: 4 * HOUR },
        { projectId: snowtime.id, userId: kadri, total: 2.5 * HOUR },
        { projectId: null, userId: me, total: 0.75 * HOUR },
      ],
      tickets: [],
    })
    const { search } = renderView({ range: 'this-week', view: 'breakdown' })
    expect(await screen.findByText('By project, then member')).toBeInTheDocument()
    // It totals the range, so the unit stays out of its input.
    expect(fn.getReportBreakdown.mock.lastCall![0]).toEqual({
      organizationId,
      from: '2026-09-21',
      to: '2026-09-28',
    })
    const panel = screen.getByRole('tabpanel', { name: 'Breakdown' })
    const snowtimeRow = (await within(panel).findByText('Snowtime')).closest('li')!
    const members = within(snowtimeRow).getAllByRole('listitem')
    expect(members.map((li) => li.textContent)).toEqual([
      'Max Member (you)62%4:00',
      'Kadri Tamm38%2:30',
    ])
    expect(within(members[0]).queryByRole('button')).not.toBeInTheDocument()

    await userEvent.click(within(snowtimeRow).getByRole('button', { name: '6:30' }))
    await waitFor(() =>
      expect(search()).toEqual({ range: 'this-week', view: 'breakdown', row: snowtime.id }),
    )
    expect(fn.getReportEntries.mock.lastCall![0]).toMatchObject({
      row: { group: 'project', id: snowtime.id },
    })
  })

  test('members see one level on Breakdown, without the second level’s query', async () => {
    renderView({ range: 'this-week', view: 'breakdown' })
    expect(await screen.findByText('By project')).toBeInTheDocument()
    const panel = screen.getByRole('tabpanel', { name: 'Breakdown' })
    const snowtimeRow = within(panel).getByText('Snowtime').closest('li')!
    expect(within(snowtimeRow).queryByRole('group')).not.toBeInTheDocument()
    expect(snowtimeRow.querySelector('details')).toBeNull()
    expect(fn.getReportBreakdown).not.toHaveBeenCalled()
  })
})
