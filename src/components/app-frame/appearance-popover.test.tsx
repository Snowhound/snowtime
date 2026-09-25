import { render, screen, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { sessionQuery } from '~/lib/session'
import type { Settings } from '~/lib/settings'
import { AppearancePopover } from './appearance-popover'

const fn = vi.hoisted(() => ({ updateSettings: vi.fn(), getAppSession: vi.fn() }))
vi.mock('~/server/settings/settings.functions', () => ({ updateSettings: fn.updateSettings }))
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: fn.getAppSession }))
vi.mock('@tanstack/solid-router', () => ({
  Link: (props: { to: string; children: JSX.Element }) => <a href={props.to}>{props.children}</a>,
}))

const settings = {
  theme: 'system',
  appIcon: '02',
  sceneSeason: 'auto',
  sceneBackground: true,
  sceneStrength: 'dimmed',
  surfaces: 'glass',
  sceneWeather: true,
  sceneIntro: true,
} as Settings

// The popover reads the settings from the session query, as the header passes them.
function Header() {
  const session = useQuery(() => sessionQuery)
  return <Show when={session.data?.settings}>{(s) => <AppearancePopover settings={s()} />}</Show>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AppearancePopover', () => {
  test('a refused change goes back and says why', async () => {
    // jsdom has no matchMedia, which the scenery fields ask about reduced motion.
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(sessionQuery.queryKey, { settings } as never)
    fn.getAppSession.mockResolvedValue({ settings })
    fn.updateSettings.mockRejectedValue(new Error('offline'))
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Header />
      </QueryClientProvider>
    ))

    await userEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    const dialog = await screen.findByRole('dialog', { name: 'Appearance' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dark' }))

    expect(await within(dialog).findByText('Something went wrong. Try again.')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'System' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
