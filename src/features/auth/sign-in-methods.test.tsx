import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { ProviderButtons } from './sign-in-methods'

// Server functions and Better Auth stay out of the DOM tests.
vi.mock('~/server/auth/auth.functions', () => ({ getDevUsers: vi.fn() }))
const social = vi.fn()
vi.mock('~/lib/auth-client', () => ({
  authClient: { signIn: { social: (...args: unknown[]) => social(...args) } },
}))

function buttons() {
  return screen.queryAllByRole('button').map((button) => button.textContent)
}

describe('ProviderButtons', () => {
  test('shows only the providers getSignInMethods returned, in its order', () => {
    render(() => (
      <ProviderButtons
        methods={['github', 'password', 'passkey']}
        callbackURL="/timer"
        errorCallbackURL="/sign-in"
        onError={() => {}}
      />
    ))
    expect(buttons()).toEqual(['Continue with GitHub'])
  })

  test('shows nothing when no provider is configured', () => {
    render(() => (
      <ProviderButtons
        methods={['passkey']}
        callbackURL="/"
        errorCallbackURL="/"
        onError={() => {}}
      />
    ))
    expect(buttons()).toEqual([])
  })

  test('starts the provider sign-in with the return address and reports a failure', async () => {
    social.mockResolvedValue({ error: { code: 'PROVIDER_NOT_FOUND' } })
    const onError = vi.fn()
    render(() => (
      <ProviderButtons
        methods={['google', 'github', 'microsoft']}
        callbackURL="/reports"
        errorCallbackURL="/sign-in?redirect=%2Freports"
        onError={onError}
      />
    ))
    expect(buttons()).toEqual([
      'Continue with Google',
      'Continue with GitHub',
      'Continue with Microsoft',
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Microsoft' }))
    expect(social).toHaveBeenCalledWith({
      provider: 'microsoft',
      callbackURL: '/reports',
      errorCallbackURL: '/sign-in?redirect=%2Freports',
    })
    expect(onError).toHaveBeenCalledWith("Sign-in didn't finish. Try again or use another method.")
    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeEnabled()
  })
})
