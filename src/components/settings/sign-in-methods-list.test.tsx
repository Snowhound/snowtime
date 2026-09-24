import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SignInMethod } from '~/server/sign-in.server'
import { SignInMethodsList } from './sign-in-methods-list'

// Better Auth stays out of the DOM tests; each call resolves to { data, error } like the
// real client.
const client = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  unlinkAccount: vi.fn(),
  linkSocial: vi.fn(),
  passkey: { listUserPasskeys: vi.fn(), addPasskey: vi.fn(), deletePasskey: vi.fn() },
}))
vi.mock('~/lib/auth-client', () => ({ authClient: client }))

function account(id: string, providerId: string) {
  return {
    id,
    providerId,
    accountId: `${providerId}-user`,
    createdAt: new Date('2026-09-01T10:00:00Z'),
  }
}

function renderList(methods: SignInMethod[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(() => (
    <QueryClientProvider client={queryClient}>
      <SignInMethodsList methods={methods} timeZone="Europe/Tallinn" />
    </QueryClientProvider>
  ))
}

function row(name: string) {
  return screen.getByText(name, { selector: 'p' }).closest('li')!
}

beforeEach(() => {
  vi.clearAllMocks()
  client.passkey.listUserPasskeys.mockResolvedValue({ data: [], error: null })
})

describe('SignInMethodsList', () => {
  test('lists configured providers and linked ones, and keeps the last account', async () => {
    client.listAccounts.mockResolvedValue({ data: [account('a1', 'github')], error: null })
    renderList(['google', 'passkey'])

    // GitHub is no longer configured but still linked, so it stays listed.
    const github = await screen.findByText('GitHub', { selector: 'p' })
    expect(github).toBeInTheDocument()
    expect(within(row('Google')).getByRole('button', { name: 'Connect' })).toBeEnabled()
    expect(screen.queryByText('Microsoft')).toBeNull()
    expect(within(row('GitHub')).getByText('Connected since Sep 1, 2026')).toBeInTheDocument()
    expect(within(row('GitHub')).getByRole('button', { name: 'Disconnect' })).toBeDisabled()
  })

  test('disconnects a provider after confirming', async () => {
    client.listAccounts.mockResolvedValue({
      data: [account('a1', 'google'), account('a2', 'github')],
      error: null,
    })
    client.unlinkAccount.mockResolvedValue({ data: { status: true }, error: null })
    renderList(['google', 'github', 'passkey'])

    await screen.findByText('GitHub', { selector: 'p' })
    await userEvent.click(within(row('GitHub')).getByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Disconnect GitHub?')).toBeInTheDocument()
    expect(client.unlinkAccount).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    expect(client.unlinkAccount).toHaveBeenCalledWith({ accountId: 'a2' })
  })

  test('explains when Better Auth wants a fresh sign-in first', async () => {
    client.listAccounts.mockResolvedValue({
      data: [account('a1', 'google'), account('a2', 'github')],
      error: null,
    })
    client.unlinkAccount.mockResolvedValue({ data: null, error: { code: 'SESSION_NOT_FRESH' } })
    renderList(['google', 'github'])

    await screen.findByText('Google', { selector: 'p' })
    await userEvent.click(within(row('Google')).getByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    expect(
      await within(dialog).findByText(
        'For your security, sign out and sign in again, then try once more.',
      ),
    ).toBeInTheDocument()
  })

  test('lists passkeys and removes one after confirming', async () => {
    client.listAccounts.mockResolvedValue({ data: [account('a1', 'google')], error: null })
    client.passkey.listUserPasskeys.mockResolvedValue({
      data: [{ id: 'p1', name: 'Work laptop', createdAt: new Date('2026-09-10T08:00:00Z') }],
      error: null,
    })
    client.passkey.deletePasskey.mockResolvedValue({ data: { status: true }, error: null })
    renderList(['google', 'passkey'])

    await screen.findByText('Work laptop', { selector: 'p' })
    expect(within(row('Work laptop')).getByText('Added Sep 10, 2026')).toBeInTheDocument()
    await userEvent.click(within(row('Work laptop')).getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(client.passkey.deletePasskey).toHaveBeenCalledWith({ id: 'p1' })
  })
})
