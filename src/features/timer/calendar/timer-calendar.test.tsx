import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'solid-js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setTransport } from '~/lib/api/client'
import { atLocalTime } from '~/lib/calendar'
import { newId } from '~/lib/queries/query'
import type { Settings } from '~/lib/queries/settings'
import type { Entry } from '../queries'
import { TimerPage } from '../timer-page'
import { HOUR_PX } from './calendar-block'

// The backend stays out of the DOM tests; each mock answers from `server`.
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
setTransport((name, input) => fn[name as keyof typeof fn](input))
vi.mock('~/server/projects/projects.functions', () => ({ listProjects: fn.listProjects }))
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: fn.getAppSession }))
vi.mock('~/server/settings/settings.functions', () => ({ updateSettings: fn.updateSettings }))
vi.mock('@tanstack/solid-router', () => ({
  Link: (props: { to: string; class?: string; children: JSX.Element }) => (
    <a href={props.to} class={props.class}>
      {props.children}
    </a>
  ),
}))

const zone = 'Europe/Tallinn'
const organizationId = newId()
const userId = newId()
const project = {
  id: newId(),
  name: 'Snowtime',
  color: '#3b82b8',
  archivedAt: null,
  teamIds: [],
}
// A Wednesday afternoon; the shown week runs from Monday 28 September.
const NOW = atLocalTime('2026-09-30', '15:00', zone)
const COLUMN_PX = 100

function at(date: string, time: string) {
  return new Date(atLocalTime(date, time, zone))
}

const server: { entries: Entry[]; settings: Settings } = {
  entries: [],
  settings: settings('calendar'),
}

function settings(timerView: Settings['timerView']): Settings {
  return {
    timeZone: zone,
    weekStart: 'mon',
    locale: 'en',
    theme: 'system',
    timerLayout: 'bar',
    showSummary: true,
    compactRows: false,
    wideTimer: false,
    timerView,
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
}

function session() {
  return {
    activeOrganizationId: organizationId,
    user: { id: userId },
    organizations: [{ id: organizationId, name: 'Snowhound', issueLinks: null }],
    settings: { ...server.settings },
  }
}

const review: Entry = {
  id: newId(),
  organizationId,
  userId,
  projectId: project.id,
  description: 'Invoice export review',
  ticket: null,
  startedAt: at('2026-09-28', '09:00'),
  stoppedAt: at('2026-09-28', '10:30'),
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['session'], session())
  render(() => (
    <QueryClientProvider client={queryClient}>
      <TimerPage organizationId={organizationId} />
    </QueryClientProvider>
  ))
}

// jsdom has no layout: each day column is COLUMN_PX wide, side by side, from the top of the grid.
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const index = this.dataset?.date
      ? [...this.parentElement!.querySelectorAll('[data-date]')].indexOf(this)
      : 0
    const left = index * COLUMN_PX
    return { left, right: left + COLUMN_PX, top: 0, bottom: 24 * HOUR_PX } as DOMRect
  })
  server.entries = [{ ...review }]
  server.settings = settings('calendar')
  fn.getAppSession.mockImplementation(async () => session())
  fn.getRunningTimer.mockResolvedValue(null)
  fn.listEntries.mockImplementation(async () => server.entries.map((e) => ({ ...e })))
  fn.getFirstEntryStart.mockResolvedValue(review.startedAt)
  fn.listProjects.mockResolvedValue([project])
  fn.updateEntry.mockImplementation(async (data) => {
    const entry = server.entries.find((e) => e.id === data.id)!
    Object.assign(entry, data)
    return { ...entry }
  })
  fn.createEntry.mockImplementation(async (data) => {
    server.entries.push({ organizationId, userId, ticket: null, projectId: null, ...data })
    return data
  })
  fn.deleteEntry.mockImplementation(async (data) => {
    server.entries = server.entries.filter((e) => e.id !== data.id)
  })
  fn.updateSettings.mockImplementation(async ({ data }) => {
    Object.assign(server.settings, data)
    return server.settings
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// A point on the grid: the day's column (0 for Monday) and the time on it.
function point(day: number, hours: number) {
  return { clientX: day * COLUMN_PX + COLUMN_PX / 2, clientY: hours * HOUR_PX }
}

function grid() {
  return document.querySelector<HTMLElement>('.cal-cols:has([data-date])')!
}

function drag(target: Element, from: ReturnType<typeof point>, to: ReturnType<typeof point>) {
  const pointer = { button: 0, pointerType: 'mouse', pointerId: 1 }
  fireEvent.pointerDown(target, { ...pointer, ...from })
  fireEvent.pointerMove(grid(), { ...pointer, ...to })
  fireEvent.pointerUp(grid(), { ...pointer, ...to })
  fireEvent.click(target, to)
}

async function block(name = /Invoice export review/) {
  return screen.findByRole('button', { name })
}

function status() {
  return screen.getAllByRole('status').at(-1)!
}

describe('TimerCalendar', () => {
  test('the List | Calendar switch saves the view and shows the calendar', async () => {
    server.settings = settings('list')
    renderView()
    await screen.findByDisplayValue('Invoice export review')
    await userEvent.click(screen.getByRole('button', { name: 'Calendar' }))
    expect(fn.updateSettings).toHaveBeenCalledWith({ data: { timerView: 'calendar' } })
    expect(await screen.findByRole('region', { name: /Sep 28/ })).toBeInTheDocument()
    expect(await block()).toBeInTheDocument()
  })

  test('shows the work week, the weekend on its toggle, and saves the toggle', async () => {
    renderView()
    await block()
    expect(screen.queryByRole('group', { name: /Saturday/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Weekend' }))
    expect(fn.updateSettings).toHaveBeenCalledWith({ data: { calendarWeekend: true } })
    expect(await screen.findByRole('group', { name: /Saturday/ })).toBeInTheDocument()
  })

  test('a click on empty time adds its half hour, with Undo', async () => {
    renderView()
    await block()
    const tuesday = screen.getByRole('group', { name: /Tuesday/ })
    const pointer = { button: 0, pointerType: 'mouse', ...point(1, 10.25) }
    fireEvent.pointerDown(tuesday, pointer)
    fireEvent.pointerUp(grid(), pointer)
    const popover = await screen.findByRole('dialog', { name: 'Add entry' })
    expect(within(popover).getByLabelText('Start')).toHaveValue('10:00')
    expect(within(popover).getByLabelText('End')).toHaveValue('10:30')
    // The project of the entry before it.
    expect(within(popover).getByLabelText('Project')).toHaveTextContent('Snowtime')
    await userEvent.type(within(popover).getByRole('combobox'), 'Planning')
    await userEvent.click(within(popover).getByRole('button', { name: 'Save' }))
    expect(fn.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Planning',
        projectId: project.id,
        startedAt: at('2026-09-29', '10:00'),
        stoppedAt: at('2026-09-29', '10:30'),
      }),
    )
    expect(status()).toHaveTextContent('Added “Planning”: Tue 10:00–10:30.')
    const id = fn.createEntry.mock.calls[0][0].id
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(fn.deleteEntry).toHaveBeenCalledWith({ id, organizationId })
    expect(status()).toHaveTextContent('Undone.')
  })

  test('dragging an entry moves it across days, and Undo puts it back', async () => {
    renderView()
    drag(await block(), point(0, 9.5), point(1, 10.6))
    await waitFor(() =>
      expect(fn.updateEntry).toHaveBeenCalledWith({
        id: review.id,
        organizationId,
        startedAt: at('2026-09-29', '10:00'),
        stoppedAt: at('2026-09-29', '11:30'),
      }),
    )
    expect(status()).toHaveTextContent('Moved “Invoice export review”: Tue 10:00–11:30.')
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(fn.updateEntry).toHaveBeenLastCalledWith({
      id: review.id,
      organizationId,
      startedAt: review.startedAt,
      stoppedAt: review.stoppedAt,
    })
  })

  test('dragging an edge changes one end; a drop in the future changes nothing', async () => {
    renderView()
    const entry = await block()
    const end = entry.querySelector('[data-handle="end"]')!
    drag(end, point(0, 10.5), point(0, 11))
    await waitFor(() =>
      expect(fn.updateEntry).toHaveBeenCalledWith({
        id: review.id,
        organizationId,
        stoppedAt: at('2026-09-28', '11:00'),
      }),
    )
    expect(status()).toHaveTextContent('Changed “Invoice export review”: Mon 09:00–11:00.')
    fn.updateEntry.mockClear()
    // Thursday is after now.
    drag(await block(), point(0, 9.5), point(3, 9.5))
    expect(status()).toHaveTextContent("An entry can't end in the future. Nothing changed.")
    expect(fn.updateEntry).not.toHaveBeenCalled()
  })

  test('Alt+arrows move a focused entry and keep focus; Shift changes its end', async () => {
    renderView()
    const entry = await block()
    entry.focus()
    fireEvent.keyDown(entry, { key: 'ArrowDown', altKey: true })
    await waitFor(() =>
      expect(fn.updateEntry).toHaveBeenCalledWith({
        id: review.id,
        organizationId,
        startedAt: at('2026-09-28', '09:15'),
        stoppedAt: at('2026-09-28', '10:45'),
      }),
    )
    expect(document.activeElement).toBe(entry)

    fireEvent.keyDown(entry, { key: 'ArrowRight', altKey: true })
    await waitFor(() =>
      expect(fn.updateEntry).toHaveBeenLastCalledWith({
        id: review.id,
        organizationId,
        startedAt: at('2026-09-29', '09:15'),
        stoppedAt: at('2026-09-29', '10:45'),
      }),
    )
    // The entry is on Tuesday now, in a new block that has focus.
    await waitFor(() =>
      expect(within(screen.getByRole('group', { name: /Tuesday/ })).getByRole('button')).toBe(
        document.activeElement,
      ),
    )

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', altKey: true, shiftKey: true })
    await waitFor(() =>
      expect(fn.updateEntry).toHaveBeenLastCalledWith({
        id: review.id,
        organizationId,
        stoppedAt: at('2026-09-29', '10:30'),
      }),
    )
    expect(status()).toHaveTextContent('Changed “Invoice export review”: Tue 09:15–10:30.')
  })

  test('a click edits an entry, and Delete removes it with Undo', async () => {
    renderView()
    await userEvent.click(await block())
    const popover = await screen.findByRole('dialog', { name: 'Edit entry' })
    expect(within(popover).getByLabelText('End')).toHaveValue('10:30')
    await userEvent.click(within(popover).getByRole('button', { name: 'Delete' }))
    expect(fn.deleteEntry).toHaveBeenCalledWith({ id: review.id, organizationId })
    expect(status()).toHaveTextContent('Deleted “Invoice export review”.')
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(fn.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Invoice export review',
        startedAt: review.startedAt,
        stoppedAt: review.stoppedAt,
      }),
    )
  })
})
