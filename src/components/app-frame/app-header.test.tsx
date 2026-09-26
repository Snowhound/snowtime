import { render, screen, waitFor } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'solid-js'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { newId } from '~/lib/query'
import { sessionQuery } from '~/lib/session'
import { AppHeader } from './app-header'

const fn = vi.hoisted(() => ({
  getAppSession: vi.fn(),
  setActive: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: fn.getAppSession }))
vi.mock('~/server/settings/settings.functions', () => ({ updateSettings: vi.fn() }))
vi.mock('~/lib/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/auth-client')>()),
  authClient: { organization: { setActive: fn.setActive } },
}))
vi.mock('@tanstack/solid-router', () => ({
  Link: (props: {
    to: string
    params?: { org: string }
    class?: string
    children: JSX.Element
  }) => (
    <a href={props.to.replace('$org', props.params?.org ?? '$org')} class={props.class}>
      {props.children}
    </a>
  ),
  useNavigate: () => fn.navigate,
  useRouterState: (options: { select: (state: unknown) => unknown }) => () =>
    options.select({ location: { pathname: '/northwind/projects' } }),
}))

const northwind = { id: newId(), name: 'Northwind', slug: 'northwind', role: 'admin' }
const harbor = { id: newId(), name: 'Harbor', slug: 'harbor', role: 'member' }

const session = {
  user: { id: newId(), name: 'Max Member', email: 'member@example.com', image: null },
  activeOrganizationId: harbor.id,
  organizations: [harbor, northwind],
  settings: null,
}

// The tab shows Northwind, from its URL, while the session's default is Harbor.
function renderHeader() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(sessionQuery.queryKey, session as never)
  render(() => (
    <QueryClientProvider client={queryClient}>
      <AppHeader organizationId={northwind.id} />
    </QueryClientProvider>
  ))
  return queryClient
}

// An open menu takes its trigger out of the accessibility tree.
function switcher() {
  return screen.getByRole('button', { name: /^Organization:/, hidden: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  fn.getAppSession.mockResolvedValue(session)
  fn.setActive.mockResolvedValue({ data: {}, error: null })
})

describe('AppHeader', () => {
  test('shows the organization of the tab, not the session’s default', () => {
    renderHeader()
    expect(switcher()).toHaveAccessibleName('Organization: Northwind')
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]
    const links = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    // Northwind's admin sees its Organization page too.
    expect(links).toEqual([
      '/northwind/timer',
      '/northwind/reports',
      '/northwind/projects',
      '/northwind/organization',
    ])
  })

  test('switching opens the same page in the other organization and keeps every cache', async () => {
    const queryClient = renderHeader()
    const projects = [{ id: newId(), name: 'Website redesign' }]
    queryClient.setQueryData(['projects', northwind.id], projects)

    await userEvent.click(switcher())
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Harbor' }))

    expect(fn.navigate).toHaveBeenCalledWith({ href: '/harbor/projects' })
    // The session's default follows, for `/` and new tabs, and the session is read again.
    expect(fn.setActive).toHaveBeenCalledWith({ organizationId: harbor.id })
    await waitFor(() => expect(fn.getAppSession).toHaveBeenCalled())
    expect(queryClient.getQueryData(['projects', northwind.id])).toEqual(projects)
  })

  test('picking the organization the tab shows does nothing', async () => {
    renderHeader()
    await userEvent.click(switcher())
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Northwind' }))
    expect(fn.navigate).not.toHaveBeenCalled()
    expect(fn.setActive).not.toHaveBeenCalled()
  })
})
