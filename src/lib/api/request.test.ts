import { describe, expect, mock, test } from 'bun:test'
import { AppError } from '~/server/errors'
import { inviteMember } from './auth'
import { listEntries, updateEntry } from './entries'
import { setSend } from './request'
import { getRunningTimer } from './timer'

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

// Answers every request with `body` and records what was asked.
function answer(status: number, body: unknown) {
  const requests: { path: string; init: RequestInit }[] = []
  setSend(
    mock(async (path: string, init: RequestInit) => {
      requests.push({ path, init })
      return Response.json(body, { status })
    }),
  )
  return requests
}

describe('a request', () => {
  test('a read sends its input as the query string and decodes dates', async () => {
    const requests = answer(200, [entry])
    const entries = await listEntries({
      organizationId,
      from: new Date('2026-09-30T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
      userId,
    })
    expect(requests[0].path).toBe(
      `/api/v1/organizations/${organizationId}/entries?from=2026-09-30T00%3A00%3A00.000Z&to=2026-10-01T00%3A00%3A00.000Z&userId=${userId}`,
    )
    expect(requests[0].init.method).toBe('GET')
    expect(requests[0].init.body).toBeUndefined()
    expect(entries[0].startedAt).toEqual(new Date(entry.startedAt))
    expect(entries[0].stoppedAt).toBeNull()
  })

  test('a write sends the rest of its input as JSON, its ids in the path', async () => {
    const requests = answer(200, { ...entry, description: 'Renamed' })
    await updateEntry({ organizationId, id: entry.id, description: 'Renamed' })
    expect(requests[0].path).toBe(`/api/v1/organizations/${organizationId}/entries/${entry.id}`)
    expect(requests[0].init.method).toBe('PATCH')
    expect(JSON.parse(requests[0].init.body as string)).toEqual({ description: 'Renamed' })
  })

  test('a refusal throws the AppError, and an answer off the contract throws', async () => {
    answer(403, { error: { code: 'FORBIDDEN', key: 'entries_forbidden' } })
    const range = { organizationId, from: new Date(0), to: new Date(1) }
    const list = listEntries(range)
    await expect(list).rejects.toBeInstanceOf(AppError)
    await expect(list).rejects.toMatchObject({ code: 'FORBIDDEN', key: 'entries_forbidden' })

    answer(200, [{ ...entry, startedAt: 'yesterday' }])
    await expect(listEntries(range)).rejects.toThrow()
  })

  test('a call without input sends nothing', async () => {
    const requests = answer(200, null)
    expect(await getRunningTimer()).toBeNull()
    expect(requests[0].path).toBe('/api/v1/timer')
    expect(requests[0].init.body).toBeUndefined()
  })

  test("Better Auth's refusal throws with its status and code, as its client reports it", async () => {
    answer(400, {
      error: { code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION', message: 'Taken' },
    })
    const invite = inviteMember({
      organizationId,
      email: 'member@example.com',
      role: 'member',
      teamId: null,
    })
    await expect(invite).rejects.toMatchObject({
      status: 400,
      code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION',
    })
  })
})
