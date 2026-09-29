import { render, screen } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Settings } from '~/lib/queries/settings'
import { PreferencesCard } from './preferences-card'

const fn = vi.hoisted(() => ({ updateSettings: vi.fn() }))
vi.mock('~/server/settings/settings.functions', () => ({ updateSettings: fn.updateSettings }))
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: vi.fn() }))

const SETTINGS: Settings = {
  timeZone: 'Europe/Tallinn',
  weekStart: 'mon',
  locale: 'en',
  theme: 'system',
  timerLayout: 'bar',
  showSummary: true,
  compactRows: false,
  wideTimer: false,
  timerView: 'list',
  calendarWeekend: false,
  appIcon: '02',
  sceneCollection: 'mountains',
  scenePin: null,
  sceneBackground: true,
  sceneStrength: 'dimmed',
  surfaces: 'glass',
  sceneWeather: true,
  sceneIntro: true,
  sceneTagline: true,
  durationFormat: 'clock',
  dateFormat: 'dmy',
  timeFormat: '24h',
  country: null,
}

function renderCard(settings: Partial<Settings> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(() => (
    <QueryClientProvider client={queryClient}>
      <PreferencesCard settings={{ ...SETTINGS, ...settings }} />
    </QueryClientProvider>
  ))
}

beforeEach(() => {
  vi.clearAllMocks()
  fn.updateSettings.mockImplementation(({ data }) => Promise.resolve({ ...SETTINGS, ...data }))
})

describe('Country', () => {
  test('names the guess from the time zone', () => {
    renderCard({ timeZone: 'America/Chicago' })
    const select = screen.getByLabelText<HTMLSelectElement>('Country')
    expect(select.selectedOptions[0]?.textContent).toBe('From time zone (United States)')
    expect(select).toHaveAccessibleDescription(/public holidays/)
  })

  test('saves a country, and null for the guess', async () => {
    renderCard({ country: 'US' })
    const select = screen.getByLabelText<HTMLSelectElement>('Country')
    expect(select.value).toBe('US')
    await userEvent.selectOptions(select, 'From time zone (Estonia)')
    expect(fn.updateSettings).toHaveBeenLastCalledWith({ data: { country: null } })
    await userEvent.selectOptions(select, 'Other')
    expect(fn.updateSettings).toHaveBeenLastCalledWith({ data: { country: 'other' } })
  })
})
