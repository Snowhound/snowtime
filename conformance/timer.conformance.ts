// The timer's calls on the contract (task 084), over HTTP. Every backend that serves the
// JSON API passes these: `bun run test:conformance`, with CONFORMANCE_URL for one already
// running (server.ts). The tests run in order, as one user's day: each builds on the
// writes before it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import type { Transport } from '~/lib/api/client'
import { type OperationName, operations } from '~/lib/api/operations'
import { httpTransport } from '~/lib/api/transports'
import { requestOf } from '~/lib/api/wire'
import { COMPANY, SEED_NOW } from '../perf/lib/database'
import { type ServerUnderTest, serverUnderTest } from './server'

const HOUR = 3_600_000

let server: ServerUnderTest
let headers: { admin: Record<string, string>; member: Record<string, string> }
// The admin's calls, decoded as the client decodes them.
let admin: Transport

beforeAll(async () => {
  server = await serverUnderTest()
  headers = { admin: await server.as('admin'), member: await server.as('member') }
  admin = httpTransport(server.url, headers.admin)
}, 120_000)
afterAll(() => server?.stop())

// A call's raw answer, for the refusals the transport would throw.
async function send(
  name: OperationName,
  input: unknown,
  requestHeaders: Record<string, string> = headers.admin,
) {
  const operation = operations[name]
  const { path, body } = requestOf(operation, input)
  const response = await fetch(`${server.url}${path}`, {
    method: operation.method,
    headers: body ? { ...requestHeaders, 'content-type': 'application/json' } : requestHeaders,
    body,
  })
  return { status: response.status, body: (await response.json()) as unknown }
}

function refused(code: string, key: string) {
  return { error: { code, key } }
}

const organizationId = COMPANY.id
const first = uuidv7()
const second = uuidv7()

describe('the session', () => {
  test('a call without a session is refused', async () => {
    expect(await send('getRunningTimer', undefined, {})).toEqual({
      status: 401,
      body: refused('UNAUTHENTICATED', 'sign_in_required'),
    })
  })

  test('a write from another origin, or naming none, is refused', async () => {
    const input = { organizationId, id: uuidv7() }
    const { origin: _, ...noOrigin } = headers.admin
    expect((await send('startTimer', input, noOrigin)).status).toBe(403)
    expect(
      (await send('startTimer', input, { ...headers.admin, origin: 'https://evil.example' }))
        .status,
    ).toBe(403)
    expect(await admin('getRunningTimer', undefined)).toBeNull()
  })

  test('an organization the user is not in is refused', async () => {
    const { status, body } = await send('startTimer', { organizationId: uuidv7(), id: uuidv7() })
    expect({ status, body }).toEqual({
      status: 403,
      body: refused('FORBIDDEN', 'not_organization_member'),
    })
  })
})

describe('the timer', () => {
  test('starting a timer returns it running, with nothing stopped', async () => {
    const { started, stopped } = await admin('startTimer', {
      organizationId,
      id: first,
      description: '  Planning  ',
    })
    expect(started).toMatchObject({
      id: first,
      organizationId,
      projectId: null,
      description: 'Planning',
      ticket: null,
      stoppedAt: null,
    })
    expect(started.startedAt.getTime()).toBeGreaterThanOrEqual(SEED_NOW.getTime())
    expect(stopped).toBeNull()
    expect(await admin('getRunningTimer', undefined)).toEqual({ ...started, project: null })
  })

  test('starting another stops the first', async () => {
    const { started, stopped } = await admin('startTimer', {
      organizationId,
      id: second,
      ticket: 'LUM-12',
    })
    expect(started).toMatchObject({ id: second, ticket: 'LUM-12', stoppedAt: null })
    expect(stopped?.id).toBe(first)
    expect(stopped!.stoppedAt!.getTime()).toBeGreaterThan(stopped!.startedAt.getTime())
    expect((await admin('getRunningTimer', undefined))?.id).toBe(second)
  })

  test('stopping an entry that is not running is refused', async () => {
    expect(await send('stopTimer', { id: first })).toEqual({
      status: 404,
      body: refused('NOT_FOUND', 'timer_not_running'),
    })
  })

  test('stopping the running timer returns it stopped', async () => {
    const stopped = await admin('stopTimer', { id: second })
    expect(stopped.id).toBe(second)
    expect(stopped.stoppedAt!.getTime()).toBeGreaterThan(stopped.startedAt.getTime())
    expect(await admin('getRunningTimer', undefined)).toBeNull()
  })

  test('input that fails the schema is refused with a message', async () => {
    const { status, body } = await send('startTimer', { organizationId, id: 'not-a-uuid' })
    expect(status).toBe(400)
    expect(body).toMatchObject({ error: { message: expect.any(String) } })
  })
})

// The admin's entries around SEED_NOW.
function today() {
  return admin('listEntries', {
    organizationId,
    from: new Date(SEED_NOW.getTime() - 12 * HOUR),
    to: new Date(SEED_NOW.getTime() + 12 * HOUR),
  })
}

describe('entries', () => {
  test("the day's entries list the timer's, newest first", async () => {
    const entries = await today()
    const ids = entries.map((e) => e.id)
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first))
    const starts = entries.map((e) => e.startedAt.getTime())
    expect(starts).toEqual(starts.toSorted((a, b) => b - a))
  })

  test("a member can't list the admin's entries", async () => {
    const [entry] = await today()
    const { status, body } = await send(
      'listEntries',
      {
        organizationId,
        from: new Date(SEED_NOW.getTime() - HOUR),
        to: SEED_NOW,
        userId: entry.userId,
      },
      headers.member,
    )
    expect({ status, body }).toEqual({
      status: 403,
      body: refused('FORBIDDEN', 'entries_forbidden'),
    })
  })

  test('a range longer than the limit is refused', async () => {
    const { status } = await send('listEntries', {
      organizationId,
      from: new Date(SEED_NOW.getTime() - 100 * 24 * HOUR),
      to: SEED_NOW,
    })
    expect(status).toBe(400)
  })

  test('an entry logged by hand is created, edited, and deleted', async () => {
    const id = uuidv7()
    const startedAt = new Date(SEED_NOW.getTime() - 4 * HOUR)
    const stoppedAt = new Date(SEED_NOW.getTime() - 3 * HOUR)
    const created = await admin('createEntry', {
      organizationId,
      id,
      description: 'Review',
      startedAt,
      stoppedAt,
    })
    expect(created).toMatchObject({ id, description: 'Review', startedAt, stoppedAt })

    const updated = await admin('updateEntry', { organizationId, id, description: 'Code review' })
    expect(updated).toEqual({ ...created, description: 'Code review' })

    expect(
      await send('updateEntry', {
        organizationId,
        id,
        stoppedAt: new Date(startedAt.getTime() - 1),
      }),
    ).toEqual({ status: 422, body: refused('INVALID', 'entry_end_before_start') })

    expect(await admin('deleteEntry', { organizationId, id })).toEqual({ id })
    expect(await send('deleteEntry', { organizationId, id })).toEqual({
      status: 404,
      body: refused('NOT_FOUND', 'entry_not_found'),
    })
  })

  test("the user's first entry started before today", async () => {
    const [entry] = await today()
    const first = await admin('getFirstEntryStart', { organizationId, userId: entry.userId })
    expect(first).toBeInstanceOf(Date)
    expect(first!.getTime()).toBeLessThan(SEED_NOW.getTime() - 24 * HOUR)
  })
})
