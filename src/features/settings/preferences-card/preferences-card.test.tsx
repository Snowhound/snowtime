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
  copyDurationPattern: 'H:MM:SS',
  copyDurationControl: 'text',
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

describe('Copied durations', () => {
  test('previews the pattern while typing and saves it on Enter', async () => {
    renderCard()
    const input = screen.getByLabelText<HTMLInputElement>('Copied durations')
    expect(input.value).toBe('H:MM:SS')
    await userEvent.clear(input)
    await userEvent.type(input, 'Hh Mm Ss')
    expect(screen.getByText('2h 5m 9s')).toBeInTheDocument()
    expect(fn.updateSettings).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(fn.updateSettings).toHaveBeenLastCalledWith({
      data: { copyDurationPattern: 'Hh Mm Ss' },
    })
  })

  test("shows an error for a pattern without a field, and doesn't save it", async () => {
    renderCard()
    const input = screen.getByLabelText<HTMLInputElement>('Copied durations')
    await userEvent.clear(input)
    await userEvent.type(input, 'hms')
    await userEvent.tab()
    expect(screen.getByText('Use H, M, or S, in at most 40 characters.')).toBeInTheDocument()
    expect(fn.updateSettings).not.toHaveBeenCalled()
  })

  test('warns when a field is inside a word, and the escape clears it', async () => {
    renderCard()
    const input = screen.getByLabelText<HTMLInputElement>('Copied durations')
    await userEvent.clear(input)
    await userEvent.type(input, 'Hours: H')
    expect(screen.getByText(/H is inside a word/)).toBeInTheDocument()
    await userEvent.clear(input)
    await userEvent.type(input, '\\Hours: H')
    expect(screen.queryByText(/is inside a word/)).not.toBeInTheDocument()
  })

  test('Escape returns to the saved pattern', async () => {
    renderCard({ copyDurationPattern: 'HH:MM' })
    const input = screen.getByLabelText<HTMLInputElement>('Copied durations')
    await userEvent.type(input, 'x{Escape}')
    expect(input.value).toBe('HH:MM')
  })

  test('an example and Reset save at once', async () => {
    renderCard({ copyDurationPattern: 'HH:MM' })
    await userEvent.click(screen.getByRole('button', { name: 'M:SS' }))
    expect(fn.updateSettings).toHaveBeenLastCalledWith({ data: { copyDurationPattern: 'M:SS' } })
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(fn.updateSettings).toHaveBeenLastCalledWith({
      data: { copyDurationPattern: 'H:MM:SS' },
    })
  })

  test('saves how a duration is copied', async () => {
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'A copy button' }))
    expect(fn.updateSettings).toHaveBeenLastCalledWith({ data: { copyDurationControl: 'button' } })
  })
})
