// The calendar's calls on the contract (task 097.02), over HTTP. The server under test has no
// calendar provider's client, so these cover what needs no provider: reading calendars and
// events without a connection, the refusals, and logging entries with event keys.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import { COMPANY, SEED_NOW } from '../perf/lib/database'
import {
  type Caller,
  type CallName,
  caller,
  refused,
  send as sendTo,
  type ServerUnderTest,
  serverUnderTest,
} from './server'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const organizationId = COMPANY.id

let server: ServerUnderTest
let headers: Record<string, string>
let member: Caller

beforeAll(async () => {
  server = await serverUnderTest()
  headers = await server.as('member')
  member = caller(server.url, headers)
}, 120_000)
afterAll(() => server?.stop())

function send(name: CallName, input: unknown, as = headers) {
  return sendTo(server.url, name, input, as)
}

describe('calendars', () => {
  test('a user without a connection has none, and no events', async () => {
    const calendars = await member('getCalendars', undefined)
    expect(calendars.connections).toEqual([])
    expect(typeof calendars.available).toBe('boolean')
    const range = { from: new Date(SEED_NOW.getTime() - 7 * DAY), to: SEED_NOW }
    expect(await member('listCalendarEvents', { organizationId, ...range })).toEqual({
      events: [],
      logs: [],
      connections: [],
    })
  })

  test('reading events is refused over 93 days, and without a session', async () => {
    const from = new Date(SEED_NOW.getTime() - 94 * DAY)
    const { status, body } = await send('listCalendarEvents', {
      organizationId,
      from,
      to: SEED_NOW,
    })
    expect(status).toBe(400)
    expect(body).toMatchObject({
      error: { key: 'validation_range_too_long', params: { days: 93 } },
    })
    expect(
      (await send('listCalendarEvents', { organizationId, from: SEED_NOW, to: SEED_NOW }, {}))
        .status,
    ).toBe(401)
  })

  test('a callback whose state the server did not seal is refused', async () => {
    expect(
      await send('finishCalendarConnection', { code: 'code', state: 'v1.forged.state' }),
    ).toEqual({
      status: 422,
      body: refused('INVALID', 'calendar_state_invalid'),
    })
  })

  test('connecting needs a path of the app to return to', async () => {
    const { status } = await send('connectCalendar', { returnTo: 'https://evil.example' })
    expect(status).toBe(400)
  })

  test("a calendar or connection that isn't the user's is not found", async () => {
    expect(await send('updateCalendarSource', { id: uuidv7(), shown: true })).toEqual({
      status: 404,
      body: refused('NOT_FOUND', 'calendar_source_not_found'),
    })
    expect(await send('disconnectCalendar', { id: uuidv7() })).toEqual({
      status: 404,
      body: refused('NOT_FOUND', 'calendar_connection_not_found'),
    })
  })
})

// A meeting three weeks back, clear of the seeded entries' daily limit.
function meeting(key: string, hoursAgo: number, description = 'Standup') {
  const startedAt = new Date(SEED_NOW.getTime() - 20 * DAY - hoursAgo * HOUR)
  return {
    id: uuidv7(),
    startedAt,
    stoppedAt: new Date(startedAt.getTime() + HOUR / 4),
    calendarEvent: key,
    description,
  }
}

describe('logging events', () => {
  test('createEntries logs meetings with their keys, each with its own description', async () => {
    const key = `google:conformance:${uuidv7()}`
    const entries = [meeting(`${key}-1`, 3, 'Standup'), meeting(`${key}-2`, 2, 'Sprint review')]
    const created = await member('createEntries', { organizationId, description: '', entries })
    expect(created.map((e) => [e.description, e.calendarEvent])).toEqual([
      ['Standup', `${key}-1`],
      ['Sprint review', `${key}-2`],
    ])
    const listed = await member('listEntries', {
      organizationId,
      from: new Date(entries[0].startedAt.getTime() - HOUR),
      to: new Date(entries[1].stoppedAt.getTime() + HOUR),
    })
    expect(listed.find((e) => e.id === created[0].id)?.calendarEvent).toBe(`${key}-1`)
  })

  test('an event logged once is refused again, and logs again once its entry is deleted', async () => {
    const key = `google:conformance:${uuidv7()}`
    const first = await member('createEntry', { organizationId, ...meeting(key, 5) })
    expect(first.calendarEvent).toBe(key)
    expect(
      await send('createEntries', { organizationId, description: '', entries: [meeting(key, 5)] }),
    ).toEqual({ status: 409, body: refused('CONFLICT', 'calendar_event_logged') })
    await member('deleteEntry', { organizationId, id: first.id })
    const again = await member('createEntry', { organizationId, ...meeting(key, 5) })
    expect(again.calendarEvent).toBe(key)
  })

  test('an entry not logged from a calendar has no key', async () => {
    const { calendarEvent: _, ...plain } = meeting('unused:x', 7)
    expect((await member('createEntry', { organizationId, ...plain })).calendarEvent).toBeNull()
  })
})
