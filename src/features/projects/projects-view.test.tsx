import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'solid-js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Project } from '~/lib/projects'
import { newId } from '~/lib/query'
import { AppError } from '~/server/errors'
import { ProjectsPage } from './projects-page'

// The server functions stay out of the DOM tests. Each mock answers from `server`, so a
// refetch after a mutation sees what the server would return.
const fn = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  unarchiveProject: vi.fn(),
  deleteProject: vi.fn(),
  assignProjectToTeam: vi.fn(),
  unassignProjectFromTeam: vi.fn(),
  listTeams: vi.fn(),
  getReport: vi.fn(),
  getAppSession: vi.fn(),
}))
vi.mock('~/server/projects/projects.functions', () => ({
  listProjects: fn.listProjects,
  createProject: fn.createProject,
  updateProject: fn.updateProject,
  archiveProject: fn.archiveProject,
  unarchiveProject: fn.unarchiveProject,
  deleteProject: fn.deleteProject,
  assignProjectToTeam: fn.assignProjectToTeam,
  unassignProjectFromTeam: fn.unassignProjectFromTeam,
}))
vi.mock('~/server/teams/teams.functions', () => ({ listTeams: fn.listTeams }))
vi.mock('~/server/reports/reports.functions', () => ({ getReport: fn.getReport }))
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: fn.getAppSession }))
// The view renders without a router; its one link only needs to be there.
vi.mock('@tanstack/solid-router', () => ({
  Link: (props: { to: string; class?: string; children: JSX.Element }) => (
    <a href={props.to} class={props.class}>
      {props.children}
    </a>
  ),
}))

const organizationId = newId()
const userId = newId()
const HOUR = 3_600_000

const platform = { id: newId(), name: 'Platform', members: [{ userId, role: 'member' }] }
const design = { id: newId(), name: 'Design', members: [] }
const client = { id: newId(), name: 'Client services', members: [] }

function project(name: string, patch: Partial<Project> = {}): Project {
  return { id: newId(), name, color: '#2a78d6', archivedAt: null, teamIds: [], ...patch }
}

const server: { role: 'member' | 'admin'; projects: Project[] } = {
  role: 'member',
  projects: [],
}

function session() {
  return {
    activeOrganizationId: organizationId,
    role: server.role,
    user: { id: userId },
    organizations: [{ id: organizationId, name: 'Snowhound' }],
    settings: { timeZone: 'Europe/Tallinn' },
  }
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['session'], session())
  render(() => (
    <QueryClientProvider client={queryClient}>
      <ProjectsPage />
    </QueryClientProvider>
  ))
}

let snowtime: Project
let website: Project

beforeEach(() => {
  vi.clearAllMocks()
  snowtime = project('Snowtime', { teamIds: [platform.id, design.id] })
  website = project('Website 2025', { archivedAt: new Date('2026-06-30T12:00:00Z') })
  server.role = 'member'
  server.projects = [snowtime, website]
  fn.getAppSession.mockImplementation(async () => session())
  fn.listProjects.mockImplementation(async () => server.projects)
  fn.listTeams.mockResolvedValue([platform, design, client])
  fn.getReport.mockImplementation(async () => ({
    projects: [{ projectId: snowtime.id, total: 12.5 * HOUR }],
  }))
  function change(id: string, patch: (p: Project) => Partial<Project>) {
    server.projects = server.projects.map((p) => (p.id === id ? { ...p, ...patch(p) } : p))
  }
  fn.createProject.mockImplementation(async ({ data }) => {
    server.projects = [...server.projects, project(data.name, data)]
  })
  fn.updateProject.mockImplementation(async ({ data }) => change(data.id, () => data))
  fn.archiveProject.mockImplementation(async ({ data }) =>
    change(data.id, () => ({ archivedAt: new Date() })),
  )
  fn.unarchiveProject.mockImplementation(async ({ data }) =>
    change(data.id, () => ({ archivedAt: null })),
  )
  fn.deleteProject.mockImplementation(async ({ data }) => {
    server.projects = server.projects.filter((p) => p.id !== data.id)
  })
  fn.assignProjectToTeam.mockImplementation(async ({ data }) =>
    change(data.projectId, (p) => ({ teamIds: [...p.teamIds, data.teamId] })),
  )
  fn.unassignProjectFromTeam.mockImplementation(async ({ data }) =>
    change(data.projectId, (p) => ({ teamIds: p.teamIds.filter((t) => t !== data.teamId) })),
  )
})

afterEach(() => {
  vi.useRealTimers()
})

async function openActions(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }))
  return screen.findByRole('menu')
}

async function chooseAction(name: string, action: string) {
  const menu = await openActions(name)
  await userEvent.click(within(menu).getByRole('menuitem', { name: action }))
}

describe('ProjectsView', () => {
  test('members see their own time and no actions', async () => {
    renderView()
    expect(await screen.findByText('Snowtime')).toBeInTheDocument()
    expect(fn.getReport).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId }),
    })
    expect(screen.getByText('You, this month')).toBeInTheDocument()
    expect(screen.getByText('12:30')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Admins and owners create and change projects/)).toBeInTheDocument()
  })

  test("admins see the organization's time and manage projects", async () => {
    server.role = 'admin'
    renderView()
    expect(await screen.findByText('Snowtime')).toBeInTheDocument()
    const report = fn.getReport.mock.calls[0][0].data
    expect(report).not.toHaveProperty('userId')
    expect(screen.getByText('This month')).toBeInTheDocument()
    expect(screen.getByText('Snowhound · 1 active, 1 archived')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions for Snowtime' })).toBeInTheDocument()
  })

  test('the dialog checks the name, and suggests restoring an archived clash', async () => {
    server.role = 'admin'
    renderView()
    await userEvent.click(await screen.findByRole('button', { name: 'New project' }))
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    const name = within(dialog).getByLabelText('Name')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(await within(dialog).findByText('Enter a name.')).toBeInTheDocument()

    await userEvent.type(name, ' Snowtime ')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(
      await within(dialog).findByText('A project called Snowtime already exists.'),
    ).toBeInTheDocument()

    await userEvent.clear(name)
    await userEvent.type(name, 'Website 2025')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(
      await within(dialog).findByText(
        'An archived project is called Website 2025. Restore it, or pick another name.',
      ),
    ).toBeInTheDocument()
    expect(fn.createProject).not.toHaveBeenCalled()
  })

  test('creates a project with the least used color and its teams', async () => {
    server.role = 'admin'
    renderView()
    await userEvent.click(await screen.findByRole('button', { name: 'New project' }))
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    // Blue is taken by the active Snowtime; the archived project doesn't count.
    expect(within(dialog).getByRole('radio', { name: 'Orange' })).toBeChecked()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Q4 planning')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Design' }))
    expect(within(dialog).getByText(/Only members of Design can track time/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))

    expect(await screen.findByText('Q4 planning')).toBeInTheDocument()
    expect(fn.createProject).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Q4 planning', color: '#eb6834' }),
    })
    const { id } = fn.createProject.mock.calls[0][0].data
    await waitFor(() =>
      expect(fn.assignProjectToTeam).toHaveBeenCalledWith({
        data: { projectId: id, teamId: design.id },
      }),
    )
    expect(fn.assignProjectToTeam).toHaveBeenCalledTimes(1)
    expect(fn.unassignProjectFromTeam).not.toHaveBeenCalled()
  })

  test('editing calls only the changed teams', async () => {
    server.role = 'admin'
    renderView()
    await chooseAction('Snowtime', 'Edit')
    const dialog = await screen.findByRole('dialog', { name: 'Edit project' })
    expect(within(dialog).getByRole('checkbox', { name: 'Platform' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Design' })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Design' }))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Client services' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fn.unassignProjectFromTeam).toHaveBeenCalledTimes(1))
    expect(fn.unassignProjectFromTeam).toHaveBeenCalledWith({
      data: { projectId: snowtime.id, teamId: design.id },
    })
    expect(fn.assignProjectToTeam).toHaveBeenCalledTimes(1)
    expect(fn.assignProjectToTeam).toHaveBeenCalledWith({
      data: { projectId: snowtime.id, teamId: client.id },
    })
    // Name and color are unchanged.
    expect(fn.updateProject).not.toHaveBeenCalled()
  })

  test('archives only once confirmed', async () => {
    server.role = 'admin'
    renderView()
    await chooseAction('Snowtime', 'Archive')
    let dialog = await screen.findByRole('dialog', { name: 'Archive Snowtime?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fn.archiveProject).not.toHaveBeenCalled()

    await chooseAction('Snowtime', 'Archive')
    dialog = await screen.findByRole('dialog', { name: 'Archive Snowtime?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(fn.archiveProject).toHaveBeenCalledWith({ data: { id: snowtime.id } })
    // Moved to Archived before the server answers.
    expect(screen.getByText('Snowhound · 0 active, 2 archived')).toBeInTheDocument()
  })

  test('a refused delete offers to archive instead', async () => {
    server.role = 'admin'
    fn.deleteProject.mockRejectedValue(new AppError('CONFLICT', 'project_has_entries'))
    renderView()
    await chooseAction('Snowtime', 'Delete')
    const confirm = await screen.findByRole('dialog', { name: 'Delete Snowtime?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete project' }))
    expect(fn.deleteProject).toHaveBeenCalledWith({ data: { id: snowtime.id } })

    const refused = await screen.findByRole('dialog', { name: 'Snowtime has tracked time' })
    // The refusal came within the delay, so the row never left.
    expect(screen.getByText('Snowtime')).toBeInTheDocument()
    await userEvent.click(within(refused).getByRole('button', { name: 'Archive instead' }))
    expect(fn.archiveProject).toHaveBeenCalledWith({ data: { id: snowtime.id } })
  })

  test('a slow delete shows the row pending, then removes it', async () => {
    server.role = 'admin'
    let answer!: () => void
    fn.deleteProject.mockImplementation(
      ({ data }) =>
        new Promise<void>((resolve) => {
          answer = () => {
            server.projects = server.projects.filter((p) => p.id !== data.id)
            resolve()
          }
        }),
    )
    renderView()
    await chooseAction('Snowtime', 'Delete')
    const confirm = await screen.findByRole('dialog', { name: 'Delete Snowtime?' })
    // Fake timers from here, so the delay passes without waiting for it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete project' }))
    await vi.advanceTimersByTimeAsync(10)

    const row = screen.getByText('Snowtime').closest('li')!
    expect(row).toHaveAttribute('aria-busy', 'true')
    expect(within(row).getByRole('button', { hidden: true })).toBeDisabled()
    await vi.advanceTimersByTimeAsync(489)
    expect(screen.getByText('Snowtime')).toBeInTheDocument()
    // Gone once the delay is over, before the server answers.
    await vi.advanceTimersByTimeAsync(1)
    expect(screen.queryByText('Snowtime')).not.toBeInTheDocument()

    vi.useRealTimers()
    answer()
    await waitFor(() => expect(fn.listProjects).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Snowtime')).not.toBeInTheDocument()
  })

  test('a refused delete of an archived project only explains', async () => {
    server.role = 'admin'
    fn.deleteProject.mockRejectedValue(new AppError('CONFLICT', 'project_has_entries'))
    renderView()
    await userEvent.click(await screen.findByRole('tab', { name: /Archived/ }))
    await chooseAction('Website 2025', 'Delete')
    const confirm = await screen.findByRole('dialog', { name: 'Delete Website 2025?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete project' }))

    const refused = await screen.findByRole('dialog', { name: 'Website 2025 has tracked time' })
    expect(within(refused).getByText(/It stays archived/)).toBeInTheDocument()
    expect(within(refused).queryByRole('button', { name: 'Archive instead' })).toBeNull()
    await userEvent.click(within(refused).getByRole('button', { name: 'OK' }))
    expect(fn.archiveProject).not.toHaveBeenCalled()
  })

  test('a new organization offers its first project and links to Organization for teams', async () => {
    server.role = 'admin'
    server.projects = []
    fn.listTeams.mockResolvedValue([])
    renderView()
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'New project' })
    await userEvent.click(buttons[buttons.length - 1])
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    expect(
      within(dialog).getByRole('link', { name: 'Create teams in Organization' }),
    ).toHaveAttribute('href', '/organization')
  })
})
