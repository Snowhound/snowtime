import { renderHook } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { JSX } from 'solid-js'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { newId } from '~/lib/query'
import { MAX_ENTRY_MS } from '~/server/entries/entries.schemas'
import { type Entry, entriesQuery, useCreateEntry, useStopTimer } from './queries'

// Each write waits on `pending`, so a test sees the caches before the server answers.
const fn = vi.hoisted(() => ({
  createEntry: vi.fn(),
  stopTimer: vi.fn(),
  listEntries: vi.fn(),
}))
vi.mock('~/server/entries/entries.functions', () => ({
  createEntry: fn.createEntry,
  listEntries: fn.listEntries,
  deleteEntry: vi.fn(),
  getFirstEntryStart: vi.fn(),
  updateEntry: vi.fn(),
}))
vi.mock('~/server/timer/timer.functions', () => ({
  getRunningTimer: vi.fn(),
  startTimer: vi.fn(),
  stopTimer: fn.stopTimer,
}))
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: vi.fn() }))

const HOUR = 3_600_000
const organizationId = newId()
const userId = newId()
const now = Date.now()
const today = { from: now - 12 * HOUR, to: now + 12 * HOUR }

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['session'], {
    activeOrganizationId: organizationId,
    user: { id: userId },
  })
  function wrapper(props: { children: JSX.Element }) {
    return <QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>
  }
  return { queryClient, wrapper }
}

function entriesOf(queryClient: QueryClient, org: string, user: string, range: typeof today) {
  return queryClient.getQueryData(entriesQuery(org, user, range).queryKey)
}

let pending: Promise<never>
beforeEach(() => {
  vi.clearAllMocks()
  pending = new Promise(() => {})
  fn.createEntry.mockReturnValue(pending)
  fn.stopTimer.mockReturnValue(pending)
})

describe('timer mutations', () => {
  test('a new entry shows only in the lists of its organization, user, and days', async () => {
    const { queryClient, wrapper } = setup()
    const yesterday = { from: today.from - 24 * HOUR, to: today.from }
    const lists: [string, string, typeof today][] = [
      [organizationId, userId, today],
      [newId(), userId, today],
      [organizationId, newId(), today],
      [organizationId, userId, yesterday],
    ]
    for (const [org, user, range] of lists) {
      queryClient.setQueryData(entriesQuery(org, user, range).queryKey, [])
    }
    const { result } = renderHook(() => useCreateEntry(), { wrapper })

    result.mutate({
      id: newId(),
      description: 'Logged by hand',
      startedAt: new Date(now - 2 * HOUR),
      stoppedAt: new Date(now - HOUR),
    })

    await vi.waitFor(() => expect(entriesOf(queryClient, ...lists[0])).toHaveLength(1))
    for (const list of lists.slice(1)) expect(entriesOf(queryClient, ...list)).toEqual([])
  })

  test('stopping a timer that ran past the cap ends it there at once, as the server does', async () => {
    const { queryClient, wrapper } = setup()
    const startedAt = new Date(now - 30 * HOUR)
    const running: Entry = {
      id: newId(),
      organizationId,
      userId,
      projectId: null,
      description: 'Left running',
      startedAt,
      stoppedAt: null,
    }
    const range = { from: now - 48 * HOUR, to: now + HOUR }
    queryClient.setQueryData(entriesQuery(organizationId, userId, range).queryKey, [running])
    const { result } = renderHook(() => useStopTimer(), { wrapper })

    result.mutate({ id: running.id })

    await vi.waitFor(() =>
      expect(entriesOf(queryClient, organizationId, userId, range)?.[0].stoppedAt).toEqual(
        new Date(startedAt.getTime() + MAX_ENTRY_MS),
      ),
    )
  })

  test('a write marks the reports stale, so Reports and Projects load them again', async () => {
    const { queryClient, wrapper } = setup()
    const reportKey = ['report', organizationId, { from: '2026-09-01', to: '2026-09-30' }]
    queryClient.setQueryData(reportKey, { totals: [] })
    fn.createEntry.mockResolvedValue(undefined)
    fn.listEntries.mockResolvedValue([])
    const { result } = renderHook(() => useCreateEntry(), { wrapper })

    await result.mutateAsync({
      id: newId(),
      description: 'Logged by hand',
      startedAt: new Date(now - 2 * HOUR),
      stoppedAt: new Date(now - HOUR),
    })

    await vi.waitFor(() => expect(queryClient.getQueryState(reportKey)?.isInvalidated).toBe(true))
  })
})
