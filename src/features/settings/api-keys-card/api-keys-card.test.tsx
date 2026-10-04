import { render, screen, waitFor, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setTransport } from '~/lib/api/client'
import { mockTransport } from '~/lib/api/testing'
import type { ApiKey } from '~/server/auth/auth.schemas'
import { AppError } from '~/server/errors'
import { ApiKeysCard, relativeTime } from './api-keys-card'

const fn = vi.hoisted(() => ({
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}))
setTransport(mockTransport(fn))

const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000

function apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: crypto.randomUUID(),
    name: 'Raycast on MacBook',
    access: 'write',
    createdAt: new Date(NOW - 21 * DAY),
    expiresAt: new Date(NOW + 69 * DAY),
    lastUsedAt: new Date(NOW - 4 * 60_000),
    ...overrides,
  }
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(() => (
    <QueryClientProvider client={queryClient}>
      <ApiKeysCard timeZone="Europe/Tallinn" />
    </QueryClientProvider>
  ))
}

function row(name: string) {
  return screen.getByText(name).closest('li')!
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ApiKeysCard', () => {
  test('says so when there are no keys', async () => {
    fn.listApiKeys.mockResolvedValue([])
    renderCard()
    expect(
      await screen.findByText('No keys yet. Create one to connect an external application.'),
    ).toBeInTheDocument()
  })

  test('lists each key by name, access, dates, and last use, with no part of the key', async () => {
    fn.listApiKeys.mockResolvedValue([
      apiKey(),
      apiKey({ name: 'Team dashboard', access: 'read', expiresAt: null, lastUsedAt: null }),
    ])
    renderCard()
    await screen.findByText('Raycast on MacBook')
    const raycast = within(row('Raycast on MacBook'))
    expect(raycast.getByText('Read and write')).toBeInTheDocument()
    expect(raycast.getByText('Last used 4 minutes ago')).toBeInTheDocument()
    const dashboard = within(row('Team dashboard'))
    expect(dashboard.getByText('Read only')).toBeInTheDocument()
    expect(dashboard.getByText('Never expires')).toBeInTheDocument()
    expect(dashboard.getByText('Never used')).toBeInTheDocument()
    expect(screen.queryByText(/snow_/)).toBeNull()
  })

  test('says how soon a key expires within a week, and marks an expired one', async () => {
    fn.listApiKeys.mockResolvedValue([
      apiKey({ name: 'Soon', expiresAt: new Date(NOW + 3 * DAY + 60_000) }),
      apiKey({ name: 'Old tray app', expiresAt: new Date(NOW - 5 * DAY) }),
    ])
    renderCard()
    await screen.findByText('Soon')
    expect(within(row('Soon')).getByText('Expires in 3 days')).toBeInTheDocument()
    const old = within(row('Old tray app'))
    expect(old.getByText('Expired')).toBeInTheDocument()
    expect(old.getByRole('button', { name: 'Remove Old tray app' })).toBeInTheDocument()
  })

  test('creates a read-only key by default and shows it once', async () => {
    const user = userEvent.setup()
    fn.listApiKeys.mockResolvedValue([])
    fn.createApiKey.mockResolvedValue({ id: crypto.randomUUID(), key: 'snow_secretvalue' })
    renderCard()
    await user.click(await screen.findByRole('button', { name: 'Create key' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByRole('combobox', { name: 'Expires' })).toHaveValue('90d')
    expect(dialog.getByRole('button', { name: 'Read only' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(dialog.getByRole('button', { name: 'Create key' }))
    expect(await dialog.findByText('Enter a name.')).toBeInTheDocument()
    expect(fn.createApiKey).not.toHaveBeenCalled()

    await user.type(dialog.getByRole('textbox', { name: 'Name' }), 'Raycast')
    await user.click(dialog.getByRole('button', { name: 'Create key' }))
    await waitFor(() =>
      expect(fn.createApiKey).toHaveBeenCalledWith({
        name: 'Raycast',
        lifetime: '90d',
        access: 'read',
      }),
    )
    const shown = within(await screen.findByRole('dialog'))
    expect(await shown.findByDisplayValue('snow_secretvalue')).toBeInTheDocument()

    await user.click(shown.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByDisplayValue('snow_secretvalue')).toBeNull())
  })

  test('sends the chosen lifetime and access', async () => {
    const user = userEvent.setup()
    fn.listApiKeys.mockResolvedValue([])
    fn.createApiKey.mockResolvedValue({ id: crypto.randomUUID(), key: 'snow_x' })
    renderCard()
    await user.click(await screen.findByRole('button', { name: 'Create key' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.type(dialog.getByRole('textbox', { name: 'Name' }), 'Raycast')
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Expires' }), 'none')
    expect(dialog.getByText('The key works until you revoke it.')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Read and write' }))
    await user.click(dialog.getByRole('button', { name: 'Create key' }))
    await waitFor(() =>
      expect(fn.createApiKey).toHaveBeenCalledWith({
        name: 'Raycast',
        lifetime: 'none',
        access: 'write',
      }),
    )
  })

  test('shows why a key was not created', async () => {
    const user = userEvent.setup()
    fn.listApiKeys.mockResolvedValue([])
    fn.createApiKey.mockRejectedValue(new AppError('LIMIT_REACHED', 'api_key_limit'))
    renderCard()
    await user.click(await screen.findByRole('button', { name: 'Create key' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.type(dialog.getByRole('textbox', { name: 'Name' }), 'One too many')
    await user.click(dialog.getByRole('button', { name: 'Create key' }))
    expect(
      await dialog.findByText('You have too many API keys. Revoke unused ones first.'),
    ).toBeInTheDocument()
  })

  test('revokes a key after confirming', async () => {
    const user = userEvent.setup()
    const key = apiKey()
    fn.listApiKeys.mockResolvedValueOnce([key]).mockResolvedValue([])
    fn.revokeApiKey.mockResolvedValue({ id: key.id })
    renderCard()
    await user.click(await screen.findByRole('button', { name: 'Revoke Raycast on MacBook' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Revoke “Raycast on MacBook”?')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Revoke key' }))
    expect(fn.revokeApiKey).toHaveBeenCalledWith({ id: key.id })
    expect(await screen.findByText('Revoked “Raycast on MacBook”.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke Raycast on MacBook' })).toBeNull()
  })
})

test('relativeTime picks the nearest unit', () => {
  expect(relativeTime(NOW - 4 * 60_000, NOW)).toBe('4 minutes ago')
  expect(relativeTime(NOW - 3 * 60 * 60_000, NOW)).toBe('3 hours ago')
  expect(relativeTime(NOW + 3 * DAY, NOW)).toBe('in 3 days')
})
