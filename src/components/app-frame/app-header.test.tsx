import { render, screen, waitFor } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { For, type JSX, Show, createEffect } from 'solid-js'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { type Project, projectsQuery } from '~/lib/projects'
import { newId } from '~/lib/query'
import { followSession, sessionQuery } from '~/lib/session'
import { AppHeader } from './app-header'
import { OrganizationNotice } from './organization-notice'

// The server answers for the session's active organization, as scopeMiddleware does, and
// the Better Auth client's setActive changes it.
const fn = vi.hoisted(() => ({
  getAppSession: vi.fn(),
  listProjects: vi.fn(),
  setActive: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: fn.getAppSession }))
vi.mock('~/server/projects/projects.functions', () => ({ listProjects: fn.listProjects }))
vi.mock('~/server/settings/settings.functions', () => ({ updateSettings: vi.fn() }))
vi.mock('~/lib/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/auth-client')>()),
  authClient: { organization: { setActive: fn.setActive } },
}))
vi.mock('@tanstack/solid-router', () => ({
  Link: (props: { to: string; class?: string; children: JSX.Element }) => (
    <a href={props.to} class={props.class}>
      {props.children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: fn.invalidate }),
  useRouterState: (options: { select: (state: unknown) => unknown }) => () =>
    options.select({ location: { pathname: '/projects' } }),
}))

function project(name: string): Project {
  return { id: newId(), name, color: '#3b82b8', archivedAt: null, teamIds: [] }
}

const northwind = { id: newId(), name: 'Northwind', slug: 'northwind', role: 'member' }
const harbor = { id: newId(), name: 'Harbor', slug: 'harbor', role: 'member' }
const projects: Record<string, Project[]> = {
  [northwind.id]: [project('Website redesign')],
  [harbor.id]: [project('Client onboarding')],
}
const server = { activeOrganizationId: northwind.id, organizations: [northwind, harbor] }

const maxId = newId()

function session() {
  return {
    user: { id: maxId, name: 'Max Member', email: 'member@example.com', image: null },
    role: 'member',
    activeOrganizationId: server.activeOrganizationId,
    organizations: server.organizations,
    settings: null,
  }
}

// What a page shows: the active organization's projects, afresh when it changes. Each render
// records the organization it is for and the names it shows.
const shown: { organizationId: string; names: string[] }[] = []
function ProjectsPage() {
  const current = useQuery(() => sessionQuery)
  return (
    <Show when={current.data?.activeOrganizationId} keyed>
      {(organizationId) => {
        const list = useQuery(() => projectsQuery(organizationId))
        createEffect(() => {
          if (list.data) shown.push({ organizationId, names: list.data.map((p) => p.name) })
        })
        return <For each={list.data}>{(p) => <p>{p.name}</p>}</For>
      }}
    </Show>
  )
}

function renderHeader() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  followSession(queryClient)
  queryClient.setQueryData(sessionQuery.queryKey, session() as never)
  render(() => (
    <QueryClientProvider client={queryClient}>
      <AppHeader />
      <OrganizationNotice />
      <ProjectsPage />
    </QueryClientProvider>
  ))
  return queryClient
}

// An open menu takes its trigger out of the accessibility tree, and picking an organization
// leaves it open.
function switcher() {
  return screen.getByRole('button', { name: /^Organization:/, hidden: true })
}

async function switchTo(name: string) {
  if (switcher().getAttribute('aria-expanded') !== 'true') await userEvent.click(switcher())
  await userEvent.click(await screen.findByRole('menuitemradio', { name }))
}

beforeEach(() => {
  vi.clearAllMocks()
  shown.length = 0
  server.activeOrganizationId = northwind.id
  server.organizations = [northwind, harbor]
  fn.getAppSession.mockImplementation(async () => session())
  fn.listProjects.mockImplementation(async () => projects[server.activeOrganizationId])
  fn.setActive.mockImplementation(async ({ organizationId }: { organizationId: string }) => {
    server.activeOrganizationId = organizationId
    return { data: {}, error: null }
  })
})

describe('OrganizationSwitcher', () => {
  test('never shows or caches one organization’s data as another’s', async () => {
    const queryClient = renderHeader()
    expect(await screen.findByText('Website redesign')).toBeInTheDocument()

    await switchTo('Harbor')
    expect(await screen.findByText('Client onboarding')).toBeInTheDocument()
    await waitFor(() => expect(fn.invalidate).toHaveBeenCalledTimes(1))
    await switchTo('Northwind')
    expect(await screen.findByText('Website redesign')).toBeInTheDocument()
    await waitFor(() => expect(fn.invalidate).toHaveBeenCalledTimes(2))

    for (const { organizationId, names } of shown) {
      expect(names).toEqual(projects[organizationId].map((p) => p.name))
    }
    // A dropped cache is fine; one holding the other organization's projects is not.
    for (const { id } of [northwind, harbor]) {
      const cached = queryClient.getQueryData(projectsQuery(id).queryKey)
      expect(cached ?? projects[id]).toEqual(projects[id])
    }
  })

  test('stays on the organization when the switch is refused, and reads the list again', async () => {
    renderHeader()
    expect(await screen.findByText('Website redesign')).toBeInTheDocument()
    fn.setActive.mockResolvedValue({ data: null, error: { status: 403, message: 'No' } })

    await switchTo('Harbor')
    await waitFor(() => expect(fn.getAppSession).toHaveBeenCalled())
    expect(screen.getByText('Website redesign')).toBeInTheDocument()
    expect(switcher()).toHaveAccessibleName('Organization: Northwind')
    expect(fn.invalidate).not.toHaveBeenCalled()
  })
})

// Tabs share the session: another tab's switch reaches this one when it reads the session
// again, on focus or after the server refuses a call for the old organization.
describe('OrganizationNotice', () => {
  test('follows a switch made in another tab and says so', async () => {
    const queryClient = renderHeader()
    expect(await screen.findByText('Website redesign')).toBeInTheDocument()

    server.activeOrganizationId = harbor.id
    await queryClient.refetchQueries({ queryKey: sessionQuery.queryKey })

    expect(await screen.findByText('Client onboarding')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Now in Harbor')
    expect(screen.getByRole('alert')).toHaveTextContent('You switched to it in another tab')
    expect(queryClient.getQueryData(projectsQuery(northwind.id).queryKey)).toBeUndefined()
    expect(fn.invalidate).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('stays quiet about a switch made here', async () => {
    renderHeader()
    expect(await screen.findByText('Website redesign')).toBeInTheDocument()

    await switchTo('Harbor')
    expect(await screen.findByText('Client onboarding')).toBeInTheDocument()
    await waitFor(() => expect(fn.invalidate).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('names the organization the user no longer belongs to', async () => {
    const queryClient = renderHeader()
    expect(await screen.findByText('Website redesign')).toBeInTheDocument()

    server.organizations = [harbor]
    server.activeOrganizationId = harbor.id
    await queryClient.refetchQueries({ queryKey: sessionQuery.queryKey })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You are no longer a member of Northwind.',
    )
  })
})
