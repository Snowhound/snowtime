import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { type JSX, createSignal } from 'solid-js'
import * as v from 'valibot'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, datesBetween, startOfWeek } from '~/lib/calendar'
import { newId } from '~/lib/query'
import type { ReportInput } from '~/server/reports/reports.schemas'
import { ReportSearch } from './filters'
import { ReportsPage } from './reports-page'

// The server functions stay out of the DOM tests; getReport answers from `server.rows`,
// spread over the buckets of the range it is asked for.
const fn = vi.hoisted(() => ({
  getReport: vi.fn(),
  listTeams: vi.fn(),
  listMembers: vi.fn(),
  listProjects: vi.fn(),
  getAppSession: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('~/server/reports/reports.functions', () => ({ getReport: fn.getReport }))
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

const snowtime = { id: newId(), name: 'Snowtime', color: '#2a78d6', archivedAt: null, teamIds: [] }

interface Row {
  kind: 'project' | 'member' | 'team'
  id: string | null
  // Milliseconds per bucket; missing buckets are empty.
  ms: number[]
}

const server: { role: 'member' | 'admin'; lead: boolean; rows: Row[] } = {
  role: 'member',
  lead: false,
  rows: [],
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

function session() {
  return {
    activeOrganizationId: organizationId,
    role: server.role,
    user: { id: me },
    organizations: [{ id: organizationId, name: 'Snowhound' }],
    settings: { timeZone: 'Europe/Tallinn', weekStart: 'mon' },
  }
}

function renderView(initial: ReportSearch = {}) {
  const [search, setSearch] = createSignal<ReportSearch>(initial)
  fn.navigate.mockImplementation(async (options: { search: ReportSearch }) =>
    setSearch(options.search),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['session'], session())
  render(() => (
    <QueryClientProvider client={queryClient}>
      <ReportsPage search={search()} />
    </QueryClientProvider>
  ))
  return { search }
}

function lastInput(): ReportInput {
  return fn.getReport.mock.lastCall![0].data
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
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  server.role = 'member'
  server.rows = [
    { kind: 'project', id: snowtime.id, ms: [2 * HOUR, 0, 3 * HOUR, 1.5 * HOUR] },
    { kind: 'project', id: null, ms: [0.5 * HOUR, 0, 0, 0.25 * HOUR] },
    { kind: 'member', id: me, ms: [2.5 * HOUR, 0, 3 * HOUR, 1.75 * HOUR] },
  ]
  server.lead = false
  fn.getAppSession.mockImplementation(async () => session())
  fn.getReport.mockImplementation(async (input) => report(input))
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

describe('ReportsView', () => {
  test('members see their own time by project, with row and column totals', async () => {
    renderView()
    const grid = await screen.findByRole('table')
    expect(lastInput()).toEqual({ from: '2026-09-21', to: '2026-09-28', unit: 'day' })
    expect(screen.queryByLabelText('People')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByText(/Your own time\./)).toBeInTheDocument()
    expect(
      screen.getByText(/Days and weeks in Europe\/Tallinn, starting Monday/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'change' })).toHaveAttribute(
      'href',
      '/settings#preferences',
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
    renderView({ team: design.id, group: 'team' })
    await waitFor(() => expect(fn.getReport).toHaveBeenCalled())
    expect(lastInput()).toEqual({ from: '2026-09-21', to: '2026-09-28', unit: 'day' })
  })

  test('admins choose everyone, each team and each member; no team shows as "No team"', async () => {
    server.role = 'admin'
    server.rows.push(
      { kind: 'member', id: liis, ms: [HOUR] },
      { kind: 'team', id: platform.id, ms: [2.5 * HOUR] },
    )
    renderView({ group: 'team' })
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
    expect(screen.getByText(/Everyone in the organization\./)).toBeInTheDocument()
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

    await userEvent.selectOptions(preset, 'Last week')
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-09-14', to: '2026-09-21' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next range' }))
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-09-21', to: '2026-09-28' }))
    expect(search()).toEqual({})

    await userEvent.selectOptions(preset, 'Today')
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-09-24', to: '2026-09-25' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous range' }))
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-09-23', to: '2026-09-24' }))
    expect(screen.getByLabelText('From')).toHaveValue('2026-09-23')
    expect(screen.getByLabelText('To')).toHaveValue('2026-09-23')
  })

  test('ranges over 35 days total per week', async () => {
    renderView()
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } })
    await waitFor(() =>
      expect(lastInput()).toEqual({ from: '2026-06-01', to: '2026-09-28', unit: 'week' }),
    )
    expect(await screen.findByText('Projects by week')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Day' })).toBeDisabled()

    // Back to 35 days, the unit is the user's again.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-24' } })
    await waitFor(() =>
      expect(lastInput()).toEqual({ from: '2026-08-24', to: '2026-09-28', unit: 'day' }),
    )
    expect(screen.getByRole('button', { name: 'Day' })).toBeEnabled()
  })

  test('the To date may come before From, and a year and more is refused', async () => {
    renderView()
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-10' } })
    await waitFor(() => expect(lastInput()).toMatchObject({ from: '2026-09-10', to: '2026-09-22' }))

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-01-01' } })
    expect(await screen.findByText('The range can span at most 371 days.')).toBeInTheDocument()
    expect(lastInput()).toMatchObject({ from: '2026-09-10' })
  })

  test('an empty range says so', async () => {
    server.rows = []
    renderView()
    expect(await screen.findByText('No time tracked in this range.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('bad or missing search params fall back to this week by project', async () => {
    expect(
      v.parse(ReportSearch, { range: 'someday', from: '2026-02-30', group: 'x', unit: 'hour' }),
    ).toEqual({})
    renderView({ range: 'custom', from: '2026-09-10' })
    await screen.findByRole('table')
    expect(lastInput()).toEqual({ from: '2026-09-21', to: '2026-09-28', unit: 'day' })
    expect(screen.getByLabelText('Range')).toHaveValue('this-week')
  })
})
