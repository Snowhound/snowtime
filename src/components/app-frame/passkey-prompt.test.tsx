import { render, screen } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PASSKEY_PROMPT_KEY, PasskeyPrompt } from './passkey-prompt'

const client = vi.hoisted(() => ({
  passkey: { listUserPasskeys: vi.fn(), addPasskey: vi.fn() },
}))
vi.mock('~/lib/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/auth-client')>()),
  authClient: client,
}))

const HOUR = 60 * 60 * 1000

function renderPrompt(signedInAt = new Date(Date.now() - HOUR)) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(() => (
    <QueryClientProvider client={queryClient}>
      <PasskeyPrompt signedInAt={signedInAt} />
    </QueryClientProvider>
  ))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // jsdom has no WebAuthn.
  // oxlint-disable-next-line typescript/no-extraneous-class -- mock WebAuthn constructor in jsdom
  vi.stubGlobal('PublicKeyCredential', class {})
  client.passkey.listUserPasskeys.mockResolvedValue({ data: [], error: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PasskeyPrompt', () => {
  test('adds a passkey and says how to use it', async () => {
    client.passkey.addPasskey.mockResolvedValue({ data: { id: 'p1' }, error: null })
    renderPrompt()

    await userEvent.click(await screen.findByRole('button', { name: 'Add passkey' }))

    expect(client.passkey.addPasskey).toHaveBeenCalled()
    expect(await screen.findByText('Passkey added')).toBeInTheDocument()
    expect(localStorage.getItem(PASSKEY_PROMPT_KEY)).toBe('1')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('Passkey added')).toBeNull()
  })

  test('shows an error and stays when adding fails', async () => {
    client.passkey.addPasskey.mockResolvedValue({ data: null, error: { code: 'X' } })
    renderPrompt()

    await userEvent.click(await screen.findByRole('button', { name: 'Add passkey' }))

    expect(await screen.findByText("The passkey wasn't added. Try again.")).toBeInTheDocument()
    expect(localStorage.getItem(PASSKEY_PROMPT_KEY)).toBeNull()
  })

  test('remembers Not now on this device', async () => {
    renderPrompt()

    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }))

    expect(screen.queryByText('Sign in faster next time')).toBeNull()
    expect(localStorage.getItem(PASSKEY_PROMPT_KEY)).toBe('1')
  })

  test('stays hidden for a user with a passkey, after dismissing, or on an old session', async () => {
    client.passkey.listUserPasskeys.mockResolvedValue({ data: [{ id: 'p1' }], error: null })
    renderPrompt()
    await vi.waitFor(() => expect(client.passkey.listUserPasskeys).toHaveBeenCalled())
    expect(screen.queryByText('Sign in faster next time')).toBeNull()

    vi.clearAllMocks()
    localStorage.setItem(PASSKEY_PROMPT_KEY, '1')
    renderPrompt()
    localStorage.clear()
    renderPrompt(new Date(Date.now() - 25 * HOUR))
    expect(client.passkey.listUserPasskeys).not.toHaveBeenCalled()
  })
})
