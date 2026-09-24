import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { newId } from '../../lib/query'
import type { Entry, RunningTimer } from '../../lib/timer'
import { addDays, atLocalTime, localDate } from '../../server/calendar'
import { AppError } from '../../server/errors'
import { TimerView } from './timer-view'

// The server functions stay out of the DOM tests. Each mock answers from `server`, which
// a test sets up, so a refetch after a mutation sees what the server would return.
const fn = vi.hoisted(() => ({
  getRunningTimer: vi.fn(),
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  listEntries: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  listProjects: vi.fn(),
}))
vi.mock('../../functions/timer', () => ({
  getRunningTimer: fn.getRunningTimer,
  startTimer: fn.startTimer,
  stopTimer: fn.stopTimer,
}))
vi.mock('../../functions/entries', () => ({
  listEntries: fn.listEntries,
  createEntry: fn.createEntry,
  updateEntry: fn.updateEntry,
  deleteEntry: fn.deleteEntry,
}))
vi.mock('../../functions/projects', () => ({ listProjects: fn.listProjects }))
vi.mock('../../functions/auth', () => ({ getAppSession: vi.fn() }))

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

const server: { running: RunningTimer | null; entries: Entry[] } = { running: null, entries: [] }

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
  queryClient.setQueryData(['session'], {
    activeOrganizationId: organizationId,
    user: { id: userId },
  })
  render(() => (
    <QueryClientProvider client={queryClient}>
      <TimerView
        organizationId={organizationId}
        userId={userId}
        zone={zone}
        organizations={[{ id: organizationId, name: 'Snowhound' }]}
      />
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
  fn.getRunningTimer.mockImplementation(async () => server.running)
  fn.listEntries.mockImplementation(async () => server.entries)
  fn.listProjects.mockResolvedValue([snowtime])
})

describe('TimerView', () => {
  test('starts on Enter and stops, showing each at once', async () => {
    renderView()
    await screen.findByText('Invoice export review')
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
    expect(await screen.findByText('Timer view')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  test('rolls back a failed start and says why', async () => {
    renderView()
    await screen.findByText('Invoice export review')
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
    await screen.findByText('Invoice export review')
    fn.deleteEntry.mockImplementation(async () => {
      server.entries = []
    })

    await userEvent.click(screen.getByRole('button', { name: 'Delete Invoice export review' }))
    expect(fn.deleteEntry).toHaveBeenCalledWith({ data: { id: expect.any(String) } })
    expect(screen.queryByText('Invoice export review')).not.toBeInTheDocument()
    expect(await screen.findByText('No time tracked yet')).toBeInTheDocument()
  })

  test('edits an entry, with an end before the start on the next day', async () => {
    renderView()
    await screen.findByText('Invoice export review')
    fn.updateEntry.mockResolvedValue({})

    await userEvent.click(screen.getByRole('button', { name: 'Edit Invoice export review' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Start')).toHaveValue('09:00')
    expect(within(dialog).getByText('Duration 1:30')).toBeInTheDocument()

    fireEvent.input(within(dialog).getByLabelText('Start'), { target: { value: '22:00' } })
    fireEvent.input(within(dialog).getByLabelText('End'), { target: { value: '01:00' } })
    expect(within(dialog).getByText('Duration 3:00 · ends the next day')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    const yesterday = addDays(localDate(Date.now(), zone), -1)
    expect(fn.updateEntry).toHaveBeenCalledWith({
      data: expect.objectContaining({
        startedAt: new Date(atLocalTime(yesterday, '22:00', zone)),
        stoppedAt: new Date(atLocalTime(addDays(yesterday, 1), '01:00', zone)),
      }),
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('adds a past entry by hand once its times are valid', async () => {
    renderView()
    await screen.findByText('Invoice export review')
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
    expect(await screen.findByText('Planning')).toBeInTheDocument()
  })
})
