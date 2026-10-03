import { afterEach, describe, expect, mock, test } from 'bun:test'
import { AppError } from '~/server/errors'
import { call, setTransport } from './client'
import { httpTransport } from './transports'

const organizationId = '01900000-0000-7000-8000-000000000201'
const userId = '01900000-0000-7000-8000-000000000104'
const entry = {
  id: '01900000-0000-7000-8000-000000000501',
  organizationId,
  userId,
  projectId: null,
  description: 'Design review',
  ticket: null,
  startedAt: '2026-09-30T06:00:00.000Z',
  stoppedAt: null,
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

// Answers every request with `body` and records what was asked.
function answer(status: number, body: unknown) {
  const requests: { url: string; init: RequestInit }[] = []
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    requests.push({ url, init: init ?? {} })
    return Response.json(body, { status })
  }) as unknown as typeof fetch
  setTransport(httpTransport('https://snowtime.example'))
  return requests
}

describe('the HTTP transport', () => {
  test('a read sends its input as the query string and decodes dates', async () => {
    const requests = answer(200, [entry])
    const entries = await call('listEntries', {
      organizationId,
      from: new Date('2026-09-30T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
      userId,
    })
    expect(requests[0].url).toBe(
      `https://snowtime.example/api/v1/organizations/${organizationId}/entries?from=2026-09-30T00%3A00%3A00.000Z&to=2026-10-01T00%3A00%3A00.000Z&userId=${userId}`,
    )
    expect(requests[0].init.method).toBe('GET')
    expect(entries[0].startedAt).toEqual(new Date(entry.startedAt))
    expect(entries[0].stoppedAt).toBeNull()
  })

  test('a write sends the rest of its input as JSON, its ids in the path', async () => {
    const requests = answer(200, { ...entry, description: 'Renamed' })
    await call('updateEntry', { organizationId, id: entry.id, description: 'Renamed' })
    expect(requests[0].url).toBe(
      `https://snowtime.example/api/v1/organizations/${organizationId}/entries/${entry.id}`,
    )
    expect(requests[0].init.method).toBe('PATCH')
    expect(JSON.parse(requests[0].init.body as string)).toEqual({ description: 'Renamed' })
  })

  test('a call without input sends nothing', async () => {
    const requests = answer(200, null)
    expect(await call('getRunningTimer')).toBeNull()
    expect(requests[0].url).toBe('https://snowtime.example/api/v1/timer')
    expect(requests[0].init.body).toBeUndefined()
  })

  test('a refusal throws the AppError, and an answer off the contract throws', async () => {
    answer(404, { error: { code: 'NOT_FOUND', key: 'timer_not_running' } })
    const stop = call('stopTimer', { id: entry.id })
    await expect(stop).rejects.toBeInstanceOf(AppError)
    await expect(stop).rejects.toMatchObject({ code: 'NOT_FOUND', key: 'timer_not_running' })

    answer(200, { ...entry, startedAt: 'yesterday' })
    await expect(call('stopTimer', { id: entry.id })).rejects.toThrow()
  })
})
