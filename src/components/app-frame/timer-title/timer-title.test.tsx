import { render } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { createEffect, createSignal } from 'solid-js'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getRunningTimer } from '~/lib/api/timer'
import { runningTimerQuery } from '~/lib/queries/timer'
import type { RunningTimer } from '~/server/timer/timer.schemas'
import { TimerTitle } from './timer-title'

const router = vi.hoisted(() => ({ useMatches: vi.fn() }))
vi.mock('@tanstack/solid-router', () => router)

vi.mock('~/lib/api/timer', () => ({ getRunningTimer: vi.fn() }))

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const [title, setTitle] = createSignal('Timer · Snowtime')
  router.useMatches.mockReturnValue(title)
  const [userId, setUserId] = createSignal<string | undefined>('user')
  function Page() {
    // Simulate the router's competing head effect during navigation.
    createEffect(() => (document.title = title()))
    return <TimerTitle userId={userId()} />
  }
  const view = render(() => (
    <QueryClientProvider client={queryClient}>
      <Page />
    </QueryClientProvider>
  ))
  const running: RunningTimer = {
    id: 'entry',
    userId: 'user',
    organizationId: 'org',
    projectId: null,
    description: '',
    ticket: null,
    startedAt: new Date(Date.now() - 65_000),
    stoppedAt: null,
    project: null,
  }
  return { queryClient, setTitle, setUserId, running, ...view }
}

test('observes timer changes and rollbacks across pages without fetching', async () => {
  const { queryClient, setTitle, running, unmount } = setup()
  await vi.waitFor(() => expect(document.title).toBe('Timer · Snowtime'))
  queryClient.setQueryData(runningTimerQuery.queryKey, running)
  await vi.waitFor(() => expect(document.title).toMatch(/^0:01:\d{2} · Timer · Snowtime$/))

  setTitle('Reports · Snowtime')
  await vi.waitFor(() => expect(document.title).toMatch(/^0:01:\d{2} · Reports · Snowtime$/))
  const before = document.title
  await vi.waitFor(() => expect(document.title).not.toBe(before), { timeout: 1500 })

  queryClient.setQueryData(runningTimerQuery.queryKey, null)
  await vi.waitFor(() => expect(document.title).toBe('Reports · Snowtime'))
  queryClient.setQueryData(runningTimerQuery.queryKey, running)
  await vi.waitFor(() => expect(document.title).toMatch(/^0:01:\d{2} · Reports · Snowtime$/))
  await queryClient.invalidateQueries({ queryKey: runningTimerQuery.queryKey })
  expect(getRunningTimer).not.toHaveBeenCalled()

  unmount()
  expect(document.title).toBe('Reports · Snowtime')
  queryClient.clear()
})

test('clears elapsed time when the session belongs to another user', async () => {
  const { queryClient, setUserId, running, unmount } = setup()
  queryClient.setQueryData(runningTimerQuery.queryKey, running)
  await vi.waitFor(() => expect(document.title).toMatch(/^0:01:/))
  setUserId('another-user')
  await vi.waitFor(() => expect(document.title).toBe('Timer · Snowtime'))
  expect(getRunningTimer).not.toHaveBeenCalled()
  unmount()
  queryClient.clear()
})

test('restores a per-user timestamp without fetching on a fresh page', async () => {
  localStorage.setItem('snowtime.timer.user', String(Date.now() - 65_000))
  localStorage.setItem('snowtime.timer.another-user', String(Date.now() - 125_000))
  const { setTitle, setUserId, unmount, queryClient } = setup()
  setTitle('Reports · Snowtime')
  await vi.waitFor(() => expect(document.title).toMatch(/^0:01:\d{2} · Reports/))
  setUserId('another-user')
  await vi.waitFor(() => expect(document.title).toMatch(/^0:02:\d{2} · Reports/))
  setUserId(undefined)
  await vi.waitFor(() => expect(document.title).toBe('Reports · Snowtime'))
  expect(getRunningTimer).not.toHaveBeenCalled()
  unmount()
  queryClient.clear()
})

test('persists cache updates and stops, and follows changes from other tabs', async () => {
  const { queryClient, running, unmount } = setup()
  queryClient.setQueryData(runningTimerQuery.queryKey, running)
  await vi.waitFor(() =>
    expect(localStorage.getItem('snowtime.timer.user')).toBe(String(running.startedAt.getTime())),
  )
  queryClient.setQueryData(runningTimerQuery.queryKey, null)
  await vi.waitFor(() => expect(localStorage.getItem('snowtime.timer.user')).toBeNull())
  queryClient.setQueryData(runningTimerQuery.queryKey, running)
  await vi.waitFor(() => expect(localStorage.getItem('snowtime.timer.user')).not.toBeNull())

  localStorage.removeItem('snowtime.timer.user')
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'snowtime.timer.user', storageArea: localStorage }),
  )
  await vi.waitFor(() => expect(document.title).toBe('Timer · Snowtime'))
  localStorage.setItem('snowtime.timer.user', String(Date.now() - 125_000))
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'snowtime.timer.user', storageArea: localStorage }),
  )
  await vi.waitFor(() => expect(document.title).toMatch(/^0:02:/))
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'snowtime.timer.another-user', storageArea: localStorage }),
  )
  await vi.waitFor(() => expect(document.title).toMatch(/^0:02:/))
  expect(getRunningTimer).not.toHaveBeenCalled()
  unmount()
  queryClient.clear()
})

test('ignores invalid or blocked storage and keeps cache updates working', async () => {
  localStorage.setItem('snowtime.timer.user', 'invalid')
  const { queryClient, running, unmount } = setup()
  await vi.waitFor(() => expect(document.title).toBe('Timer · Snowtime'))
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Blocked')
  })
  queryClient.setQueryData(runningTimerQuery.queryKey, running)
  await vi.waitFor(() => expect(document.title).toMatch(/^0:01:/))
  unmount()
  queryClient.clear()
})
