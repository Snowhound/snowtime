import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'solid-js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
  createEntries: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  deleteEntries: vi.fn(),
  listProjects: vi.fn(),
  getAppSession: vi.fn(),
  updateSettings: vi.fn(),
}))
vi.mock('~/lib/api/auth', () => fn)
vi.mock('~/lib/api/entries', () => fn)
vi.mock('~/lib/api/projects', () => fn)
vi.mock('~/lib/api/settings', () => fn)
vi.mock('~/lib/api/timer', () => fn)
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
    copyDurationPattern: 'H:MM:SS',
    copyDurationControl: 'text',
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
  calendarEvent: null,
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
  fn.createEntries.mockImplementation(async ({ entries, ...work }) => {
    const created = entries.map((times: Pick<Entry, 'id' | 'startedAt' | 'stoppedAt'>) => ({
      organizationId,
      userId,
      ticket: null,
      projectId: null,
      ...work,
      ...times,
    }))
    server.entries.push(...created)
    return created
  })
  fn.deleteEntry.mockImplementation(async (data) => {
    server.entries = server.entries.filter((e) => e.id !== data.id)
  })
  fn.deleteEntries.mockImplementation(async ({ ids }) => {
    server.entries = server.entries.filter((e) => !ids.includes(e.id))
    return { ids }
  })
  fn.updateSettings.mockImplementation(async (data) => {
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

// A click on empty time, which opens Add entry there.
function clickAt(day: number, hours: number) {
  const pointer = { button: 0, pointerType: 'mouse', ...point(day, hours) }
  const date = document.querySelectorAll('[data-date]')[day]
  fireEvent.pointerDown(date, pointer)
  fireEvent.pointerUp(grid(), pointer)
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
    expect(fn.updateSettings).toHaveBeenCalledWith({ timerView: 'calendar' })
    expect(await screen.findByRole('region', { name: /Sep 28/ })).toBeInTheDocument()
    expect(await block()).toBeInTheDocument()
  })

  test('shows the work week, the weekend on its toggle, and saves the toggle', async () => {
    renderView()
    await block()
    expect(screen.queryByRole('group', { name: /Saturday/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Weekend' }))
    expect(fn.updateSettings).toHaveBeenCalledWith({ calendarWeekend: true })
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
    await userEvent.type(within(popover).getByLabelText('Description'), 'Planning')
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

  test('dragging an edge changes one end; an entry moves into the future', async () => {
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
    await waitFor(() =>
      expect(fn.updateEntry).toHaveBeenCalledWith(
        expect.objectContaining({ id: review.id, startedAt: at('2026-10-01', '09:00') }),
      ),
    )
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

  test("Undo after deleting a logged meeting's entry brings it back with the meeting", async () => {
    const key = 'google:anna@snowhound.eu:review'
    server.entries = [{ ...review, calendarEvent: key }]
    renderView()
    await userEvent.click(await block())
    const popover = await screen.findByRole('dialog', { name: 'Edit entry' })
    await userEvent.click(within(popover).getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(fn.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Invoice export review', calendarEvent: key }),
    )
  })

  test('Repeat saves the entry and its copies in one call, which one Undo deletes', async () => {
    renderView()
    await block()
    clickAt(1, 10.25)
    const popover = await screen.findByRole('dialog', { name: 'Add entry' })
    await userEvent.type(within(popover).getByLabelText('Description'), 'Standup')
    expect(within(popover).getByLabelText('Repeat')).toHaveValue('none')
    expect(within(popover).queryByLabelText('Until')).not.toBeInTheDocument()
    await userEvent.selectOptions(within(popover).getByLabelText('Repeat'), 'day')
    const days = within(popover).getByRole('group', { name: 'Days the entry repeats on' })
    expect(
      within(days).getByRole('button', { name: /Tuesday, September 29, this entry/ }),
    ).toHaveAttribute('aria-disabled', 'true')
    const wednesday = within(days).getByRole('button', { name: 'Wednesday, September 30' })
    expect(wednesday).toHaveAttribute('aria-pressed', 'true')
    // A click takes a day out, and adds one the pattern left out.
    await userEvent.click(wednesday)
    expect(within(popover).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    await userEvent.click(wednesday)
    await userEvent.click(within(days).getByRole('button', { name: 'Monday, September 28' }))
    expect(
      within(popover).getByText(/2 copies: Mon, Sep 28 and Wed, Sep 30, 10:00–10:30/),
    ).toBeInTheDocument()
    await userEvent.click(within(popover).getByRole('button', { name: 'Add 3 entries' }))

    expect(fn.createEntry).not.toHaveBeenCalled()
    expect(fn.createEntries).toHaveBeenCalledTimes(1)
    const input = fn.createEntries.mock.calls[0][0]
    expect(input).toMatchObject({ organizationId, description: 'Standup', projectId: project.id })
    expect(input.entries.map((e: Entry) => [e.startedAt, e.stoppedAt])).toEqual([
      [at('2026-09-29', '10:00'), at('2026-09-29', '10:30')],
      [at('2026-09-28', '10:00'), at('2026-09-28', '10:30')],
      [at('2026-09-30', '10:00'), at('2026-09-30', '10:30')],
    ])
    expect(status()).toHaveTextContent('Added “Standup” on 3 days')
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(fn.deleteEntries).toHaveBeenCalledWith({
      organizationId,
      ids: input.entries.map((e: Entry) => e.id),
    })
  })

  test('Every workday fills its days at once, leaves out a day that has the entry, and keeps a day taken out', async () => {
    server.entries.push({
      ...review,
      id: newId(),
      description: 'Standup',
      startedAt: at('2026-09-30', '11:00'),
      stoppedAt: at('2026-09-30', '11:15'),
    })
    renderView()
    await block()
    clickAt(0, 11.1)
    const popover = await screen.findByRole('dialog', { name: 'Add entry' })
    await userEvent.type(within(popover).getByLabelText('Description'), 'Standup')
    await userEvent.selectOptions(within(popover).getByLabelText('Repeat'), 'workday')
    expect(within(popover).getByLabelText('Until')).toHaveValue('30.09.2026')
    expect(
      await within(popover).findByText(/Left out 1 day that already has it/),
    ).toBeInTheDocument()
    const days = within(popover).getByRole('group', { name: 'Days the entry repeats on' })
    const tuesday = within(days).getByRole('button', { name: 'Tuesday, September 29' })
    expect(tuesday).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(days).getByRole('button', { name: /Wednesday, September 30, already has this entry/ }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(within(popover).getByRole('button', { name: 'Add 2 entries' })).toBeInTheDocument()

    await userEvent.click(tuesday)
    fireEvent.input(within(popover).getByLabelText('Until'), { target: { value: '2026-10-02' } })
    // 1 and 2 October; Tuesday stays out.
    expect(
      await within(popover).findByRole('button', { name: 'Add 3 entries' }),
    ).toBeInTheDocument()
    expect(tuesday).toHaveAttribute('aria-pressed', 'false')
  })

  test('Duplicate puts a copy at the same time, which Undo deletes', async () => {
    renderView()
    await userEvent.click(await block())
    const popover = await screen.findByRole('dialog', { name: 'Edit entry' })
    await userEvent.click(within(popover).getByRole('button', { name: 'Duplicate' }))
    expect(fn.createEntries).toHaveBeenCalledWith({
      organizationId,
      description: review.description,
      ticket: null,
      projectId: project.id,
      entries: [
        { id: expect.any(String), startedAt: review.startedAt, stoppedAt: review.stoppedAt },
      ],
    })
    expect(status()).toHaveTextContent('Duplicated “Invoice export review”.')
    const [{ id }] = fn.createEntries.mock.calls[0][0].entries
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(fn.deleteEntries).toHaveBeenCalledWith({ organizationId, ids: [id] })
  })

  test("an entry's menu copies it, and empty time's menu pastes it there", async () => {
    renderView()
    fireEvent.contextMenu(await block(), point(0, 9.5))
    const entryMenu = await screen.findByRole('menu', { name: 'Entry' })
    await userEvent.click(within(entryMenu).getByRole('menuitem', { name: /^Copy(?! to)/ }))
    // The open menu hides the rest of the page from screen readers until it has closed.
    await waitFor(() =>
      expect(status()).toHaveTextContent('Copied “Invoice export review” (1:30).'),
    )

    fireEvent.contextMenu(screen.getByRole('group', { name: /Tuesday/ }), point(1, 14.1))
    const slotMenu = await screen.findByRole('menu', { name: 'Tue, Sep 29, 14:00' })
    await userEvent.click(
      within(slotMenu).getByRole('menuitem', { name: /^Paste “Invoice export review” here/ }),
    )
    // The item runs once the menu has closed.
    await waitFor(() =>
      expect(fn.createEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          description: review.description,
          projectId: project.id,
          entries: [
            {
              id: expect.any(String),
              startedAt: at('2026-09-29', '14:00'),
              stoppedAt: at('2026-09-29', '15:30'),
            },
          ],
        }),
      ),
    )
    await waitFor(() =>
      expect(status()).toHaveTextContent('Pasted “Invoice export review”: Tue 14:00–15:30.'),
    )
  })

  test('⌘C or Ctrl+C copies a focused entry; Paste every workday opens Add entry with the days filled', async () => {
    renderView()
    const entry = await block()
    entry.focus()
    fireEvent.keyDown(entry, { key: 'c', ctrlKey: true, metaKey: true })
    expect(status()).toHaveTextContent('Copied “Invoice export review” (1:30).')

    fireEvent.contextMenu(screen.getByRole('group', { name: /Tuesday/ }), point(1, 13))
    const slotMenu = await screen.findByRole('menu', { name: 'Tue, Sep 29, 13:00' })
    await userEvent.click(within(slotMenu).getByRole('menuitem', { name: 'Paste every workday…' }))
    const popover = await screen.findByRole('dialog', { name: 'Add entry' })
    expect(within(popover).getByLabelText('Description')).toHaveValue('Invoice export review')
    expect(within(popover).getByLabelText('End')).toHaveValue('14:30')
    expect(within(popover).getByLabelText('Repeat')).toHaveValue('workday')
    const days = await within(popover).findByRole('group', { name: 'Days the entry repeats on' })
    await waitFor(() =>
      expect(within(days).getByRole('button', { name: 'Wednesday, September 30' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(within(popover).getByRole('button', { name: 'Add 2 entries' })).toBeInTheDocument()
  })

  test('⌘V or Ctrl+V pastes the copied entry under the pointer, and asks to point off the grid', async () => {
    renderView()
    const entry = await block()
    entry.focus()
    fireEvent.keyDown(entry, { key: 'c', ctrlKey: true, metaKey: true })
    const tuesday = screen.getByRole('group', { name: /Tuesday/ })
    fireEvent.pointerMove(tuesday, { pointerType: 'mouse', ...point(1, 14.1) })
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true, metaKey: true })
    await waitFor(() =>
      expect(fn.createEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: [
            {
              id: expect.any(String),
              startedAt: at('2026-09-29', '14:00'),
              stoppedAt: at('2026-09-29', '15:30'),
            },
          ],
        }),
      ),
    )
    expect(status()).toHaveTextContent('Pasted “Invoice export review”: Tue 14:00–15:30.')

    fireEvent.pointerLeave(grid())
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true, metaKey: true })
    expect(status()).toHaveTextContent('Point at a time on the calendar, then press Ctrl+V')
    expect(fn.createEntries).toHaveBeenCalledTimes(1)
  })

  test("the running entry's menu only edits it, and Shift+F10 opens it under the entry", async () => {
    fn.getRunningTimer.mockResolvedValue({
      ...review,
      id: newId(),
      description: 'Running work',
      startedAt: at('2026-09-30', '13:00'),
      stoppedAt: null,
      project: null,
    })
    renderView()
    const running = await block(/Running work/)
    running.focus()
    // A keyboard's context menu event has no point on the entry.
    fireEvent.contextMenu(running, { clientX: 0, clientY: 0 })
    const entryMenu = await screen.findByRole('menu', { name: 'Entry' })
    expect(within(entryMenu).getByRole('menuitem', { name: 'Edit' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    for (const name of [/^Copy/, 'Duplicate', 'Repeat…', 'Delete']) {
      expect(within(entryMenu).getByRole('menuitem', { name })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
    }
  })

  test('Alt+drag drops a copy and leaves the entry where it was', async () => {
    renderView()
    const entry = await block()
    const pointer = { button: 0, pointerType: 'mouse', pointerId: 1 }
    fireEvent.pointerDown(entry, { ...pointer, ...point(0, 9.5) })
    fireEvent.pointerMove(grid(), { ...pointer, ...point(2, 12.5), altKey: true })
    expect(screen.getByText('Copy · 12:00–13:30 · 1:30')).toBeInTheDocument()
    fireEvent.pointerUp(grid(), { ...pointer, ...point(2, 12.5), altKey: true })
    await waitFor(() =>
      expect(fn.createEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: [
            {
              id: expect.any(String),
              startedAt: at('2026-09-30', '12:00'),
              stoppedAt: at('2026-09-30', '13:30'),
            },
          ],
        }),
      ),
    )
    expect(fn.updateEntry).not.toHaveBeenCalled()
    expect(status()).toHaveTextContent('Copied “Invoice export review” to Wed 12:00–13:30.')
  })

  describe('on touch', () => {
    const finger = { button: 0, pointerType: 'touch', pointerId: 2 }
    // Past the long press, which a block shows as pressed.
    function holdOn(entry: HTMLElement) {
      return waitFor(() => expect(entry).toHaveAttribute('data-pressed'), { timeout: 2000 })
    }
    function hold() {
      return new Promise((resolve) => setTimeout(resolve, 1000))
    }

    test("a long press that lifts opens an entry's menu, or empty time's", async () => {
      renderView()
      const entry = await block()
      fireEvent.pointerDown(entry, { ...finger, ...point(0, 9.5) })
      await holdOn(entry)
      fireEvent.pointerUp(grid(), { ...finger, ...point(0, 9.5) })
      fireEvent.click(entry)
      expect(await screen.findByRole('menu', { name: 'Entry' })).toBeInTheDocument()
      expect(screen.queryByRole('dialog', { name: 'Edit entry' })).not.toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      // The closed menu hides the rest of the page until its cleanup runs.
      const tuesday = await screen.findByRole('group', { name: /Tuesday/ })
      fireEvent.pointerDown(tuesday, { ...finger, ...point(1, 15) })
      await hold()
      fireEvent.pointerUp(grid(), { ...finger, ...point(1, 15) })
      expect(await screen.findByRole('menu', { name: 'Tue, Sep 29, 15:00' })).toBeInTheDocument()
    })

    test('a long press that then drags moves the entry', async () => {
      renderView()
      const entry = await block()
      fireEvent.pointerDown(entry, { ...finger, ...point(0, 9.5) })
      await holdOn(entry)
      fireEvent.pointerMove(entry, { ...finger, ...point(1, 10.6) })
      fireEvent.pointerUp(entry, { ...finger, ...point(1, 10.6) })
      await waitFor(() =>
        expect(fn.updateEntry).toHaveBeenCalledWith({
          id: review.id,
          organizationId,
          startedAt: at('2026-09-29', '10:00'),
          stoppedAt: at('2026-09-29', '11:30'),
        }),
      )
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    test('a touch that moves before the long press scrolls, and a tap edits', async () => {
      renderView()
      const entry = await block()
      fireEvent.pointerDown(entry, { ...finger, ...point(0, 9.5) })
      fireEvent.pointerMove(entry, { ...finger, ...point(0, 10.5) })
      await hold()
      fireEvent.pointerUp(entry, { ...finger, ...point(0, 10.5) })
      expect(entry).not.toHaveAttribute('data-pressed')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(fn.updateEntry).not.toHaveBeenCalled()

      fireEvent.pointerDown(entry, { ...finger, ...point(0, 9.5) })
      fireEvent.pointerUp(entry, { ...finger, ...point(0, 9.5) })
      fireEvent.click(entry)
      expect(await screen.findByRole('dialog', { name: 'Edit entry' })).toBeInTheDocument()
    })
  })
})
