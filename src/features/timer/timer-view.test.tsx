import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'solid-js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, atLocalTime, localDate } from '~/lib/calendar'
import { newId } from '~/lib/query'
import type { Settings } from '~/lib/settings'
import { AppError } from '~/server/errors'
import type { UpdateSettingsInput } from '~/server/settings/settings.schemas'
import type { Entry, RunningTimer } from './queries'
import { TimerPage } from './timer-page'

// The server functions stay out of the DOM tests. Each mock answers from `server`, which
// a test sets up, so a refetch after a mutation sees what the server would return.
const fn = vi.hoisted(() => ({
  getRunningTimer: vi.fn(),
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  listEntries: vi.fn(),
  getFirstEntryStart: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  listProjects: vi.fn(),
  getAppSession: vi.fn(),
  updateSettings: vi.fn(),
}))
vi.mock('~/server/timer/timer.functions', () => ({
  getRunningTimer: fn.getRunningTimer,
  startTimer: fn.startTimer,
  stopTimer: fn.stopTimer,
}))
vi.mock('~/server/entries/entries.functions', () => ({
  listEntries: fn.listEntries,
  getFirstEntryStart: fn.getFirstEntryStart,
  createEntry: fn.createEntry,
  updateEntry: fn.updateEntry,
  deleteEntry: fn.deleteEntry,
}))
vi.mock('~/server/projects/projects.functions', () => ({ listProjects: fn.listProjects }))
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: fn.getAppSession }))
vi.mock('~/server/settings/settings.functions', () => ({ updateSettings: fn.updateSettings }))
// The view renders without a router; its one link only needs to be there.
vi.mock('@tanstack/solid-router', () => ({
  Link: (props: { to: string; hash?: string; class?: string; children: JSX.Element }) => (
    <a href={`${props.to}#${props.hash}`} class={props.class}>
      {props.children}
    </a>
  ),
}))

const zone = 'Europe/Tallinn'
const organizationId = newId()
const userId = newId()
const snowtime = {
  id: newId(),
  name: 'Snowtime',
  color: '#2a78d6',
  archivedAt: null,
  teamIds: [],
}

const server: { running: RunningTimer | null; entries: Entry[]; settings: Settings } = {
  running: null,
  entries: [],
  settings: defaultSettings(),
}

function defaultSettings(): Settings {
  return {
    timeZone: zone,
    weekStart: 'mon',
    locale: 'en',
    theme: 'system',
    timerLayout: 'bar',
    showSummary: false,
  }
}

function session() {
  return {
    activeOrganizationId: organizationId,
    user: { id: userId },
    organizations: [{ id: organizationId, name: 'Snowhound' }],
    settings: { ...server.settings },
  }
}

// An entry that started `daysAgo` days ago at the time, in the test zone.
function entry(daysAgo: number, start: string, end: string, description: string): Entry {
  const date = addDays(localDate(Date.now(), zone), -daysAgo)
  return {
    id: newId(),
    organizationId,
    userId,
    projectId: snowtime.id,
    description,
    startedAt: new Date(atLocalTime(date, start, zone)),
    stoppedAt: new Date(atLocalTime(date, end, zone)),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['session'], session())
  render(() => (
    <QueryClientProvider client={queryClient}>
      <TimerPage />
    </QueryClientProvider>
  ))
}

function timer() {
  return screen.getByRole('region', { name: 'Timer' })
}

beforeEach(() => {
  vi.clearAllMocks()
  server.running = null
  server.entries = [entry(1, '09:00', '10:30', 'Invoice export review')]
  server.settings = defaultSettings()
  fn.getAppSession.mockImplementation(async () => session())
  // Copies, as the real server sends: the query cache writes into the objects it holds.
  fn.getRunningTimer.mockImplementation(async () => server.running && { ...server.running })
  fn.listEntries.mockImplementation(async () => server.entries.map((e) => ({ ...e })))
  fn.getFirstEntryStart.mockImplementation(async () => {
    const starts = [...server.entries, ...(server.running ? [server.running] : [])].map((e) =>
      e.startedAt.getTime(),
    )
    return starts.length ? new Date(Math.min(...starts)) : null
  })
  fn.listProjects.mockResolvedValue([snowtime])
})

afterEach(() => {
  vi.useRealTimers()
})

// Opens the View popover.
async function openView() {
  await userEvent.click(screen.getByRole('button', { name: 'View settings' }))
  return screen.findByRole('dialog', { name: 'View' })
}

describe('TimerView', () => {
  test('starts on Enter and stops, showing each at once', async () => {
    renderView()
    await screen.findByDisplayValue('Invoice export review')
    const started = deferred<unknown>()
    fn.startTimer.mockReturnValue(started.promise)

    await userEvent.selectOptions(within(timer()).getByLabelText('Project'), 'Snowtime')
    await userEvent.type(
      within(timer()).getByPlaceholderText('What are you working on?'),
      'Timer view{Enter}',
    )

    // Running before the server answers.
    expect(await within(timer()).findByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(fn.startTimer).toHaveBeenCalledWith({
      data: expect.objectContaining({ description: 'Timer view', projectId: snowtime.id }),
    })
    const { id } = fn.startTimer.mock.calls[0][0].data
    server.running = {
      ...entry(0, '00:00', '00:01', 'Timer view'),
      id,
      startedAt: new Date(),
      stoppedAt: null,
      project: snowtime,
    }
    started.resolve({ started: server.running, stopped: null })

    fn.stopTimer.mockImplementation(async () => {
      server.entries = [{ ...server.running!, stoppedAt: new Date() }, ...server.entries]
      server.running = null
    })
    await userEvent.click(within(timer()).getByRole('button', { name: 'Stop' }))
    expect(fn.stopTimer).toHaveBeenCalledWith({ data: { id } })
    expect(await within(timer()).findByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(within(timer()).getByPlaceholderText('What are you working on?')).toHaveValue('')
    expect(await screen.findByDisplayValue('Timer view')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  test('rolls back a failed start and says why', async () => {
    renderView()
    await screen.findByDisplayValue('Invoice export review')
    const started = deferred<unknown>()
    fn.startTimer.mockReturnValue(started.promise)

    await userEvent.click(within(timer()).getByRole('button', { name: 'Start' }))
    expect(await within(timer()).findByRole('button', { name: 'Stop' })).toBeInTheDocument()
    started.reject(new AppError('NOT_FOUND', 'project_archived'))

    expect(await within(timer()).findByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(await screen.findByText('The project is archived.')).toBeInTheDocument()
  })

  test('deletes an entry at once', async () => {
    renderView()
    await screen.findByDisplayValue('Invoice export review')
    fn.deleteEntry.mockImplementation(async () => {
      server.entries = []
    })

    await userEvent.click(screen.getByRole('button', { name: 'Delete Invoice export review' }))
    expect(fn.deleteEntry).toHaveBeenCalledWith({ data: { id: expect.any(String) } })
    expect(screen.queryByDisplayValue('Invoice export review')).not.toBeInTheDocument()
    expect(await screen.findByText('No time tracked yet')).toBeInTheDocument()
  })

  test('saves an edited description on Enter, and Escape restores it', async () => {
    renderView()
    const input = await screen.findByDisplayValue('Invoice export review')
    const { id } = server.entries[0]
    fn.updateEntry.mockImplementation(async ({ data }: { data: Partial<Entry> }) => {
      Object.assign(server.entries[0], data)
    })

    await userEvent.clear(input)
    await userEvent.type(input, 'Invoice export{Enter}')
    await waitFor(() =>
      expect(fn.updateEntry).toHaveBeenCalledWith({ data: { id, description: 'Invoice export' } }),
    )

    await waitFor(() => expect(fn.listEntries).toHaveBeenCalledTimes(2))
    await userEvent.type(input, ' draft{Escape}')
    expect(input).toHaveValue('Invoice export')
    await userEvent.tab()
    expect(fn.updateEntry).toHaveBeenCalledTimes(1)
  })

  test('reads an end before the start as the next day, and saves what that changes', async () => {
    server.entries = [entry(2, '09:00', '10:30', 'Invoice export review')]
    renderView()
    await screen.findByDisplayValue('Invoice export review')
    const { id } = server.entries[0]
    fn.updateEntry.mockResolvedValue({})

    const start = screen.getByLabelText('Start')
    fireEvent.input(start, { target: { value: '23:00' } })
    expect(screen.getByText('11:30:00')).toBeInTheDocument()
    expect(screen.getByText('Ends the next day', { selector: '.sr-only' })).toBeInTheDocument()
    fireEvent.blur(start)

    const date = addDays(localDate(Date.now(), zone), -2)
    await waitFor(() =>
      expect(fn.updateEntry).toHaveBeenCalledWith({
        data: {
          id,
          startedAt: new Date(atLocalTime(date, '23:00', zone)),
          stoppedAt: new Date(atLocalTime(addDays(date, 1), '10:30', zone)),
        },
      }),
    )
  })

  test('keeps an end in the future on the field without saving, until Escape', async () => {
    server.entries = [entry(0, '00:00', '00:01', 'Invoice export review')]
    renderView()
    await screen.findByDisplayValue('Invoice export review')

    const end = screen.getByLabelText('End')
    fireEvent.input(end, { target: { value: '23:59' } })
    fireEvent.keyDown(end, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent("An entry can't end in the future.")
    expect(end).toHaveAttribute('aria-invalid', 'true')
    expect(end).toHaveValue('23:59')
    expect(fn.updateEntry).not.toHaveBeenCalled()

    fireEvent.keyDown(end, { key: 'Escape' })
    expect(end).toHaveValue('00:01')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('rolls back a failed save and says why under the row', async () => {
    renderView()
    const input = await screen.findByDisplayValue('Invoice export review')
    fn.updateEntry.mockRejectedValue(new AppError('NOT_FOUND', 'project_archived'))

    await userEvent.clear(input)
    await userEvent.type(input, 'Renamed{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The project is archived. The change was undone.',
    )
    await waitFor(() => expect(input).toHaveValue('Invoice export review'))
  })

  test('picks the project from the row menu', async () => {
    renderView()
    await screen.findByDisplayValue('Invoice export review')
    const { id } = server.entries[0]
    fn.updateEntry.mockResolvedValue({})

    await userEvent.click(screen.getByRole('button', { name: 'Project: Snowtime' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'No project' }))
    await waitFor(() =>
      expect(fn.updateEntry).toHaveBeenCalledWith({ data: { id, projectId: null } }),
    )
  })

  test('moves an entry to another day from the date popover, keeping its times', async () => {
    renderView()
    await screen.findByDisplayValue('Invoice export review')
    const { id } = server.entries[0]
    fn.updateEntry.mockResolvedValue({})

    await userEvent.click(screen.getByRole('button', { name: /^Date: / }))
    const date = addDays(localDate(Date.now(), zone), -3)
    const input = await screen.findByLabelText('Date')
    fireEvent.input(input, { target: { value: date } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(fn.updateEntry).toHaveBeenCalledWith({
        data: {
          id,
          startedAt: new Date(atLocalTime(date, '09:00', zone)),
          stoppedAt: new Date(atLocalTime(date, '10:30', zone)),
        },
      }),
    )
  })

  test('adds a past entry by hand once its times are valid', async () => {
    renderView()
    await screen.findByDisplayValue('Invoice export review')
    fn.createEntry.mockImplementation(async ({ data }: { data: Entry }) => {
      server.entries = [...server.entries, { ...data, organizationId, userId }]
    })

    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a date, start and end time.')
    expect(fn.createEntry).not.toHaveBeenCalled()

    const date = addDays(localDate(Date.now(), zone), -2)
    fireEvent.input(within(dialog).getByLabelText('Date'), { target: { value: date } })
    fireEvent.input(within(dialog).getByLabelText('Start'), { target: { value: '13:00' } })
    fireEvent.input(within(dialog).getByLabelText('End'), { target: { value: '14:15' } })
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Planning')
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(fn.createEntry).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: 'Planning',
        projectId: null,
        startedAt: new Date(atLocalTime(date, '13:00', zone)),
        stoppedAt: new Date(atLocalTime(date, '14:15', zone)),
      }),
    })
    expect(await screen.findByDisplayValue('Planning')).toBeInTheDocument()
  })

  test('saves a layout from the View popover and shows it at once', async () => {
    renderView()
    await screen.findByDisplayValue('Invoice export review')
    const saved = deferred<unknown>()
    fn.updateSettings.mockReturnValue(saved.promise)

    const view = await openView()
    expect(within(view).getByRole('link', { name: 'All settings' })).toHaveAttribute(
      'href',
      '/settings#preferences',
    )
    await userEvent.click(within(view).getByRole('button', { name: 'Table' }))
    expect(fn.updateSettings).toHaveBeenCalledWith({ data: { timerLayout: 'table' } })

    // The table, with its day subtotal row, before the server answers.
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('rowheader', { name: 'Yesterday' })).toBeInTheDocument()
    expect(within(table).getByText('1:30')).toBeInTheDocument()
    server.settings.timerLayout = 'table'
    saved.resolve(server.settings)
    await waitFor(() => expect(fn.getAppSession).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  test('rolls back a failed layout change and says why', async () => {
    renderView()
    await screen.findByDisplayValue('Invoice export review')
    fn.updateSettings.mockRejectedValue(new AppError('NOT_FOUND', 'settings_not_found'))

    await userEvent.click(within(await openView()).getByRole('button', { name: 'Focus' }))
    expect(await screen.findByText('Load the settings first.')).toBeInTheDocument()
    expect(screen.queryByText('Continue recent')).not.toBeInTheDocument()
  })

  test('the summary counts the running timer up to now, and hides from the popover', async () => {
    // Thursday 24 September 2026, 15:00 in Tallinn; only Date is faked, so the view's
    // interval and user events keep running.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-09-24T12:00:00Z') })
    server.settings.showSummary = true
    server.entries = [
      entry(0, '09:00', '10:30', 'Invoice export review'),
      entry(3, '09:00', '11:00', 'Report time zone boundaries'), // Monday
      entry(4, '09:00', '12:00', 'Last week'),
    ]
    server.running = {
      ...entry(0, '14:15', '14:16', 'Timer layouts'),
      projectId: null,
      stoppedAt: null,
      project: null,
    }
    fn.updateSettings.mockImplementation(async (input: { data: UpdateSettingsInput }) => {
      Object.assign(server.settings, input.data)
      return server.settings
    })
    renderView()

    const summary = await screen.findByRole('complementary', { name: 'Summary' })
    expect(within(summary).getByText('Today').nextSibling).toHaveTextContent('2:15')
    expect(within(summary).getByText('This week').nextSibling).toHaveTextContent('4:15')
    expect(within(summary).getByText('Snowtime')).toBeInTheDocument()
    expect(within(summary).getByText('No project')).toBeInTheDocument()

    await userEvent.click(within(await openView()).getByRole('switch', { name: 'Show summary' }))
    expect(fn.updateSettings).toHaveBeenCalledWith({ data: { showSummary: false } })
    expect(screen.queryByRole('complementary', { name: 'Summary' })).not.toBeInTheDocument()
  })

  test('Focus continues recent work from a chip', async () => {
    server.settings.timerLayout = 'focus'
    server.entries = [
      entry(0, '09:00', '10:00', 'Invoice export review'),
      entry(1, '09:00', '10:00', 'Invoice export review'),
      entry(1, '11:00', '12:00', ''),
    ]
    fn.startTimer.mockReturnValue(new Promise(() => {}))
    renderView()

    const recent = await screen.findByRole('region', { name: 'Continue recent' })
    const chips = within(recent).getAllByRole('button')
    expect(chips).toHaveLength(1)
    await userEvent.click(chips[0])
    expect(fn.startTimer).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: 'Invoice export review',
        projectId: snowtime.id,
      }),
    })
    expect(await within(timer()).findByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  test('offers earlier entries while there are any, then says it has shown everything', async () => {
    const old = entry(20, '09:00', '10:00', 'Kickoff')
    server.entries = [entry(1, '09:00', '10:30', 'Invoice export review'), old]
    // The first range holds only the recent entry.
    fn.listEntries.mockImplementation(async ({ data }: { data: { from: Date } }) =>
      server.entries.filter((e) => e.startedAt >= data.from),
    )
    renderView()
    await screen.findByDisplayValue('Invoice export review')

    await userEvent.click(await screen.findByRole('button', { name: 'Show earlier entries' }))
    expect(await screen.findByDisplayValue('Kickoff')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show earlier entries' })).not.toBeInTheDocument()
    expect(screen.getByText(/^That's everything since .+: 2:30 in total\.$/)).toBeInTheDocument()
  })
})
