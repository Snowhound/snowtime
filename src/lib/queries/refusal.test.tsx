import { fireEvent, render, screen } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/solid-query'
import * as v from 'valibot'
import { afterEach, expect, test, vi } from 'vitest'
import { PendingChanges } from '~/components/pending-changes'
import { request, setSend } from '~/lib/api/request'
import { AppError } from '~/server/errors'
import { cacheUpdate, optimistic } from './query'
import { pendingChanges, readRetryDelay, retryAfterMs } from './refusal'
import { followSession } from './session'

const clients: QueryClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setSend((path, init) => fetch(path, init))
})

function client() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: 3, retryDelay: readRetryDelay, staleTime: Infinity },
      mutations: { retry: 3 },
    },
  })
  clients.push(client)
  return client
}

function edit(client: QueryClient) {
  return client.getMutationCache().build(client, {
    mutationFn: (value: number) => request('PATCH', '/edit', { value }, v.number()),
    ...optimistic(client, [cacheUpdate<number, number>(['entries'], (_, value) => value)], {
      invalidate: [['report']],
    }),
  })
}

function read(client: QueryClient, key: string) {
  client.setQueryData([key], 1)
  const observer = new QueryObserver(client, {
    queryKey: [key],
    queryFn: () => request('GET', `/${key}`, undefined, v.number()),
  })
  return observer.subscribe(() => {})
}

function refused() {
  return Response.json(
    { error: { code: 'UNAVAILABLE', key: 'database_unavailable' } },
    { status: 503, headers: { 'Retry-After': '2' } },
  )
}

test('injected refusals retain an edit until Try again and retry its invalidated reads with jitter', async () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  const attempts = { edit: 0, entries: 0, report: 0 }
  setSend((path) => {
    const key = path.slice(1) as keyof typeof attempts
    attempts[key]++
    return attempts[key] === 1 ? refused() : Response.json(2)
  })
  const cache = client()
  const stopEntries = read(cache, 'entries')
  const stopReport = read(cache, 'report')
  render(() => (
    <QueryClientProvider client={cache}>
      <PendingChanges />
    </QueryClientProvider>
  ))
  await expect(edit(cache).execute(2)).rejects.toBeInstanceOf(AppError)
  await vi.advanceTimersByTimeAsync(0)
  expect(cache.getQueryData(['entries'])).toBe(2)
  expect(screen.getByRole('status').textContent).toContain('Change pending')
  expect(attempts).toEqual({ edit: 1, entries: 0, report: 0 })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(attempts.edit).toBe(1)
  expect(cache.getQueryData(['entries'])).toBe(2)

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await vi.advanceTimersByTimeAsync(0)
  expect(attempts).toEqual({ edit: 2, entries: 1, report: 1 })
  await vi.advanceTimersByTimeAsync(1999)
  expect(attempts).toEqual({ edit: 2, entries: 1, report: 1 })
  await vi.advanceTimersByTimeAsync(501)
  expect(attempts).toEqual({ edit: 2, entries: 2, report: 2 })
  expect(cache.getQueryData(['entries'])).toBe(2)
  expect(pendingChanges(cache)).toHaveLength(0)
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  stopEntries()
  stopReport()
})

test('an independent read cannot overwrite a refused edit and repeated refusals keep the original rollback', async () => {
  let writes = 0
  setSend((path) => {
    if (path !== '/edit') return Response.json(1)
    writes++
    if (writes <= 2) return refused()
    return Response.json(
      { error: { code: 'FORBIDDEN', key: 'entries_forbidden' } },
      { status: 403 },
    )
  })
  const cache = client()
  read(cache, 'entries')
  const mutation = edit(cache)
  await expect(mutation.execute(2)).rejects.toMatchObject({ status: 503 })
  await cache.refetchQueries({ queryKey: ['entries'] })
  expect(cache.getQueryData(['entries'])).toBe(2)
  expect(writes).toBe(1)
  await cache.fetchQuery({
    queryKey: ['entries', 'later'],
    queryFn: () => request('GET', '/entries', undefined, v.number()),
  })
  expect(cache.getQueryData(['entries', 'later'])).toBe(2)
  await pendingChanges(cache)[0].retry()
  expect(pendingChanges(cache)).toHaveLength(1)
  expect(cache.getQueryData(['entries'])).toBe(2)
  await pendingChanges(cache)[0].retry()
  expect(pendingChanges(cache)).toHaveLength(0)
  expect(cache.getQueryData(['entries'])).toBe(1)
  expect(cache.getQueryData(['entries', 'later'])).toBe(1)
  expect(writes).toBe(3)
})

test('Retry-After supports seconds and HTTP dates, and jitter never shortens it', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  expect(retryAfterMs({ status: 503, retryAfter: '7' }, now)).toBe(7000)
  expect(retryAfterMs({ status: 503, retryAfter: 'Wed, 07 Oct 2026 12:00:09 GMT' }, now)).toBe(9000)
  expect(retryAfterMs({ status: 503, retryAfter: 'Wed, 07 Oct 2026 11:00:00 GMT' }, now)).toBe(0)
  expect(retryAfterMs({ status: 503, retryAfter: 'invalid' }, now)).toBe(0)
  vi.spyOn(Math, 'random').mockReturnValue(0)
  expect(readRetryDelay(0, { status: 503, retryAfter: '7' })).toBe(7000)
  vi.mocked(Math.random).mockReturnValue(0.75)
  expect(readRetryDelay(0, { status: 503, retryAfter: '7' })).toBe(7750)
})

test('a non-JSON edge refusal keeps status and Retry-After', async () => {
  setSend(() => new Response('Busy', { status: 503, headers: { 'Retry-After': '4' } }))
  await expect(request('PATCH', '/edit', {}, v.number())).rejects.toMatchObject({
    status: 503,
    retryAfter: '4',
  })
})

test('changing users clears refused edits and disables their old retry actions', async () => {
  let writes = 0
  setSend((path) => {
    if (path === '/edit') {
      writes++
      return refused()
    }
    return Response.json(1)
  })
  const cache = client()
  followSession(cache)
  cache.setQueryData(['session'], { user: { id: 'ada' } })
  read(cache, 'entries')
  await expect(edit(cache).execute(2)).rejects.toMatchObject({ status: 503 })
  const previous = pendingChanges(cache)[0]
  cache.setQueryData(['session'], { user: { id: 'ben' } })
  await cache.refetchQueries({ queryKey: ['entries'] })
  expect(pendingChanges(cache)).toHaveLength(0)
  expect(cache.getQueryData(['entries'])).toBe(1)
  await previous.retry()
  expect(writes).toBe(1)
})
