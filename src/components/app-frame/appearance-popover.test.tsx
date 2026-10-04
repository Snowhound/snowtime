import { render, screen, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import { describe, expect, test, vi } from 'vitest'
import { sessionQuery } from '~/lib/queries/session'
import type { Settings } from '~/lib/queries/settings'
import { useQuery } from '~/lib/queries/use-query'
import { AppearancePopover } from './appearance-popover'

const fn = vi.hoisted(() => ({ updateSettings: vi.fn(), getAppSession: vi.fn() }))
vi.mock('~/lib/api/settings', () => fn)
vi.mock('~/server/settings/settings.functions', () => ({ updateSettings: fn.updateSettings }))
vi.mock('@tanstack/solid-router', () => ({
  Link: (props: { to: string; children: JSX.Element }) => <a href={props.to}>{props.children}</a>,
}))

const settings = {
  theme: 'system',
  appIcon: '02',
  sceneCollection: 'mountains',
  scenePin: null,
  sceneBackground: true,
  sceneStrength: 'dimmed',
  surfaces: 'glass',
  sceneWeather: true,
  sceneIntro: true,
  sceneTagline: true,
} as Settings

// The popover reads the settings from the session query, as the header passes them.
function Header() {
  const session = useQuery(() => sessionQuery)
  return (
    <Show when={session.data?.settings}>
      {(s) => <AppearancePopover settings={s()} organizationSlug="snowhound" />}
    </Show>
  )
}

describe('AppearancePopover', () => {
  test('the scenery row names the collection and the pinned image, and links to Settings', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pinned = { ...settings, sceneCollection: 'coast', scenePin: 'coast-march' } as Settings
    queryClient.setQueryData(sessionQuery.queryKey, { settings: pinned } as never)
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Header />
      </QueryClientProvider>
    ))

    await userEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    const dialog = await screen.findByRole('dialog', { name: 'Appearance' })
    expect(within(dialog).getByText('March, pinned')).toBeVisible()
    expect(within(dialog).getByText('Baltic coast')).toBeVisible()
    expect(within(dialog).getByRole('link', { name: 'Change' })).toHaveAttribute(
      'href',
      '/$org/settings',
    )
    expect(
      within(dialog).getByText('A few snowflakes by day, twinkling stars at night.'),
    ).toBeVisible()
  })

  test('a refused change goes back and says why', async () => {
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
