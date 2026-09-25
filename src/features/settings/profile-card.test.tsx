import { render, screen } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { membersQuery } from '~/lib/members'
import { newId } from '~/lib/query'
import { ProfileCard } from './profile-card'

// Better Auth stays out of the DOM tests; each call resolves to { data, error } like the
// real client.
const client = vi.hoisted(() => ({
  updateUser: vi.fn(),
  listAccounts: vi.fn(),
  passkey: { listUserPasskeys: vi.fn() },
}))
vi.mock('~/lib/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/auth-client')>()),
  authClient: client,
}))
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: vi.fn() }))
vi.mock('~/server/teams/teams.functions', () => ({ listMembers: vi.fn() }))

const user = { id: newId(), name: 'Max Member', email: 'member@example.com', image: null }

beforeEach(() => {
  vi.clearAllMocks()
  client.updateUser.mockResolvedValue({ data: { status: true }, error: null })
  client.listAccounts.mockResolvedValue({ data: [], error: null })
  client.passkey.listUserPasskeys.mockResolvedValue({ data: [], error: null })
})

describe('ProfileCard', () => {
  test('a new name loads the member lists again, which show it too', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const members = membersQuery(newId()).queryKey
    queryClient.setQueryData(members, [{ userId: user.id, name: user.name }] as never)
    render(() => (
      <QueryClientProvider client={queryClient}>
        <ProfileCard user={user} timeZone="Europe/Tallinn" methods={[]} />
      </QueryClientProvider>
    ))

    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Max Mustermann')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(client.updateUser).toHaveBeenCalledWith({ name: 'Max Mustermann' })
    expect(queryClient.getQueryState(members)?.isInvalidated).toBe(true)
  })
})
