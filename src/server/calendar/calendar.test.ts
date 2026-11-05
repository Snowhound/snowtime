/// <reference types="bun" />

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '~/db'
import { calendarConnection, calendarSource, timeEntry } from '~/db/schema'
import { seedIds } from '~/db/seed'
import { createEntries, createEntry, deleteEntry } from '../entries/entries.server'
import { AppError } from '../errors'
import type { Scope } from '../scope.server'
import { as, createSeededDatabase, interleaved, scopeOf } from '../testing'
import { allDayKey, type CalendarEvent } from './calendar.schemas'
import {
  type CalendarAdapter,
  ProviderUnavailable,
  TokenRefused,
} from './providers/provider.server'

// The environment needs the server's settings, which tests don't have: only the secret the
// tokens are sealed with.
await mock.module('~/env', () => ({
  env: { BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret' },
  appUrl: 'http://localhost:3100',
  trustedOrigins: [],
}))
const {
  adapters,
  connectCalendar,
  disconnectCalendar,
  finishCalendarConnection,
  getCalendars,
  listCalendarEvents,
  logKeys,
  updateCalendarSource,
} = await import('./calendar.server')
const { seal, unseal } = await import('./tokens.server')

const { users: U, orgs: O, projects: P } = seedIds
const NOW = new Date('2026-09-23T12:00:00Z')
const HOUR = 3_600_000
const SCOPES = 'calendar events'

let db: Database
let cleanup: () => Promise<void>
let member: Scope
let memberInHarbor: Scope

// A provider in memory: one account with a primary and a team calendar, and events per
// calendar. `refusal` makes refreshing fail.
const fake = {
  calendars: [
    { id: 'max@example.com', name: 'max@example.com', color: '#039be5', primary: true },
    { id: 'team', name: 'Team', color: '#33b679', primary: false },
  ],
  events: new Map<string, Omit<CalendarEvent, 'sourceId'>[]>(),
  refusal: null as Error | null,
  revoked: [] as string[],
  refreshed: 0,
  scope: SCOPES,
}

const adapter: CalendarAdapter = {
  authorizationUrl: ({ state, codeChallenge }) =>
    `https://provider.test/auth?state=${encodeURIComponent(state)}&challenge=${codeChallenge}`,
  async exchangeCode({ code }) {
    if (code !== 'good') throw new TokenRefused()
    return {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: new Date(Date.now() + HOUR),
      scope: fake.scope,
    }
  },
  hasScopes: (scope) => scope === SCOPES,
  async refresh() {
    if (fake.refusal) throw fake.refusal
    fake.refreshed++
    return {
      accessToken: `access-${fake.refreshed + 1}`,
      expiresAt: new Date(Date.now() + HOUR),
      scope: SCOPES,
    }
  },
  async revoke(token) {
    fake.revoked.push(token)
  },
  async listCalendars() {
    return {
      account: { id: 'max@example.com', email: 'max@example.com' },
      calendars: fake.calendars,
    }
  },
  async listEvents(_token, source) {
    return (fake.events.get(source.providerCalendarId) ?? []).map((e) => ({
      ...e,
      sourceId: source.sourceId,
    }))
  },
}

function event(id: string, startHoursAgo: number, rest: Partial<CalendarEvent> = {}) {
  const startedAt = new Date(NOW.getTime() - startHoursAgo * HOUR)
  return {
    key: `google:max@example.com:${id}`,
    seriesKey: null,
    title: id,
    startedAt,
    stoppedAt: new Date(startedAt.getTime() + HOUR / 2),
    allDay: false,
    free: false,
    response: 'accepted' as const,
    kind: 'event' as const,
    ...rest,
  }
}

// The state with one character of its sealed bytes changed.
function tampered(state: string) {
  const i = state.length - 5
  return state.slice(0, i) + (state[i] === 'A' ? 'B' : 'A') + state.slice(i + 1)
}

async function connect(scope: Scope = member) {
  const { url } = await connectCalendar(db, scope.userId, { returnTo: '/northwind/settings' })
  const state = new URL(url).searchParams.get('state')!
  return as(scope, () => finishCalendarConnection(db, scope.userId, { code: 'good', state }))
}

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase(NOW))
  member = await scopeOf(db, U.member, O.northwind)
  memberInHarbor = await scopeOf(db, U.member, O.harbor)
  adapters.google = adapter
})
afterAll(() => cleanup())
beforeEach(async () => {
  await db.delete(calendarConnection)
  Object.assign(fake, { refusal: null, revoked: [], refreshed: 0, scope: SCOPES })
  fake.events = new Map()
})

describe('tokens', () => {
  test('sealed text opens only for its purpose', async () => {
    const sealed = await seal('calendar-token', 'secret-token')
    expect(sealed).not.toContain('secret-token')
    expect(await unseal('calendar-token', sealed)).toBe('secret-token')
    expect(await unseal('calendar-state', sealed)).toBeNull()
    expect(await unseal('calendar-token', 'v1.garbage.garbage')).toBeNull()
  })
})

describe('connecting', () => {
  test('stores the connection with sealed tokens, and shows only the primary calendar', async () => {
    const { returnTo, connection } = await connect()
    expect(returnTo).toBe('/northwind/settings')
    expect(connection).toMatchObject({
      provider: 'google',
      accountEmail: 'max@example.com',
      status: 'connected',
    })
    expect(connection.sources.map((s) => [s.name, s.shown, s.primary])).toEqual([
      ['max@example.com', true, true],
      ['Team', false, false],
    ])
    const [row] = await db.select().from(calendarConnection)
    expect(row.accessToken).not.toContain('access-1')
    expect(row.refreshToken).not.toContain('refresh-1')
    expect(JSON.stringify(await getCalendars(db, U.member))).not.toContain('access')
  })

  test('connecting the account again updates its row and keeps the chosen calendars', async () => {
    const first = await connect()
    const team = first.connection.sources.find((s) => s.name === 'Team')!
    await as(member, () => updateCalendarSource(db, U.member, { id: team.id, shown: true }))
    const again = await connect()
    expect(again.connection.id).toBe(first.connection.id)
    expect(again.connection.sources.find((s) => s.name === 'Team')?.shown).toBe(true)
  })

  test('a state from another user, or one that was tampered with, is refused', async () => {
    const { url } = await connectCalendar(db, U.member, { returnTo: '/northwind/settings' })
    const state = new URL(url).searchParams.get('state')!
    await expect(
      finishCalendarConnection(db, U.lead, { code: 'good', state }),
    ).rejects.toMatchObject({
      key: 'calendar_state_invalid',
    })
    await expect(
      finishCalendarConnection(db, U.member, { code: 'good', state: tampered(state) }),
    ).rejects.toMatchObject({
      key: 'calendar_state_invalid',
    })
  })

  test('without both scopes, nothing is stored and the token is revoked', async () => {
    fake.scope = 'calendar'
    await expect(connect()).rejects.toMatchObject({ key: 'calendar_scopes_missing' })
    expect(await db.select().from(calendarConnection)).toEqual([])
  })

  test('without a provider set up, the feature is unavailable', async () => {
    delete adapters.google
    try {
      expect((await getCalendars(db, U.member)).available).toBe(false)
      await expect(connectCalendar(db, U.member, { returnTo: '/' })).rejects.toMatchObject({
        key: 'calendar_unavailable',
      })
    } finally {
      adapters.google = adapter
    }
  })

  test("another user's calendar can't be changed", async () => {
    const { connection } = await connect()
    await expect(
      updateCalendarSource(db, U.lead, { id: connection.sources[0].id, shown: false }),
    ).rejects.toMatchObject({
      key: 'calendar_source_not_found',
    })
  })

  test('disconnecting revokes the token and deletes the connection and its sources', async () => {
    const { connection } = await connect()
    await disconnectCalendar(db, U.member, { id: connection.id })
    expect(fake.revoked).toEqual(['refresh-1'])
    expect(await db.select().from(calendarConnection)).toEqual([])
    expect(await db.select().from(calendarSource)).toEqual([])
  })
})

describe('reading events', () => {
  const range = {
    from: new Date(NOW.getTime() - 24 * HOUR),
    to: new Date(NOW.getTime() + 24 * HOUR),
  }

  test("answers the shown calendars' events, sorted", async () => {
    await connect()
    fake.events.set('max@example.com', [event('later', 2), event('earlier', 5)])
    fake.events.set('team', [event('hidden', 3)])
    const { events, connections } = await as(member, () => listCalendarEvents(db, member, range))
    expect(events.map((e) => e.title)).toEqual(['earlier', 'later'])
    expect(connections.map((c) => c.status)).toEqual(['connected'])
  })

  test('refreshes an access token about to expire, and keeps the new one', async () => {
    await connect()
    await as(member, async () => {
      await db
        .update(calendarConnection)
        .set({ accessTokenExpiresAt: new Date(Date.now() + 10_000) })
    })
    await as(member, () => listCalendarEvents(db, member, range))
    expect(fake.refreshed).toBe(1)
    const [row] = await db.select().from(calendarConnection)
    expect(await unseal('calendar-token', row.accessToken)).toBe('access-2')
    await as(member, () => listCalendarEvents(db, member, range))
    expect(fake.refreshed).toBe(1)
  })

  test('a refused refresh sets reconnect and answers no events, not an error', async () => {
    await connect()
    fake.events.set('max@example.com', [event('standup', 2)])
    await as(member, async () => {
      await db.update(calendarConnection).set({ accessTokenExpiresAt: new Date(0) })
    })
    fake.refusal = new TokenRefused()
    const answer = await as(member, () => listCalendarEvents(db, member, range))
    expect(answer).toMatchObject({ events: [], connections: [{ status: 'reconnect' }] })
    expect((await getCalendars(db, U.member)).connections[0].status).toBe('reconnect')
  })

  test("a provider that doesn't answer is UNAVAILABLE, and the connection stays", async () => {
    await connect()
    await as(member, async () => {
      await db.update(calendarConnection).set({ accessTokenExpiresAt: new Date(0) })
    })
    fake.refusal = new ProviderUnavailable('down')
    await expect(as(member, () => listCalendarEvents(db, member, range))).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    })
    expect((await getCalendars(db, U.member)).connections[0].status).toBe('connected')
  })

  test('answers the entries logged from the events, deleted ones and other organizations too', async () => {
    await connect()
    const here = event('here', 6)
    const gone = event('gone', 5)
    const harbor = event('harbor', 4)
    fake.events.set('max@example.com', [here, gone, harbor, event('unlogged', 3)])
    function log(scope: Scope, e: typeof here) {
      return as(scope, () =>
        createEntry(db, scope, {
          id: uuidv7(),
          description: e.title,
          startedAt: e.startedAt,
          stoppedAt: e.stoppedAt,
          calendarEvent: e.key,
        }),
      )
    }
    const hereEntry = await log(member, here)
    const goneEntry = await log(member, gone)
    await as(member, () => deleteEntry(db, member, { id: goneEntry.id }))
    await log(memberInHarbor, harbor)
    const { logs } = await as(member, () => listCalendarEvents(db, member, range))
    expect(logs.toSorted((a, b) => a.calendarEvent.localeCompare(b.calendarEvent))).toEqual([
      {
        calendarEvent: gone.key,
        entryId: goneEntry.id,
        organizationId: O.northwind,
        deleted: true,
      },
      {
        calendarEvent: harbor.key,
        entryId: expect.any(String),
        organizationId: O.harbor,
        deleted: false,
      },
      {
        calendarEvent: here.key,
        entryId: hereEntry.id,
        organizationId: O.northwind,
        deleted: false,
      },
    ])
  })
})

describe('logKeys', () => {
  test('an all-day event has a key per day in the zone; a timed one its own', () => {
    const vacation = {
      ...event('vacation', 0),
      allDay: true,
      startedAt: new Date('2026-11-11T22:00:00Z'),
      stoppedAt: new Date('2026-11-13T22:00:00Z'),
      sourceId: 's',
    }
    expect(logKeys(vacation, 'Europe/Tallinn')).toEqual([
      allDayKey(vacation.key, '2026-11-12'),
      allDayKey(vacation.key, '2026-11-13'),
    ])
    expect(logKeys({ ...event('standup', 1), sourceId: 's' }, 'Europe/Tallinn')).toEqual([
      event('standup', 1).key,
    ])
  })
})

describe('logging events', () => {
  function meeting(key: string, hoursAgo: number) {
    const startedAt = new Date(NOW.getTime() - hoursAgo * HOUR)
    return {
      id: uuidv7(),
      startedAt,
      stoppedAt: new Date(startedAt.getTime() + HOUR / 2),
      calendarEvent: key,
    }
  }

  test('one createEntries logs several meetings, each with its own title and project', async () => {
    const created = await as(member, () =>
      createEntries(db, member, {
        description: '',
        entries: [
          { ...meeting('google:c:standup-1', 30), description: 'Standup', projectId: P.website },
          {
            ...meeting('google:c:review-1', 29),
            description: 'Sprint review NBW-12',
            ticket: 'NBW-12',
          },
        ],
      }),
    )
    expect(created.map((e) => [e.description, e.projectId, e.ticket, e.calendarEvent])).toEqual([
      ['Standup', P.website, null, 'google:c:standup-1'],
      ['Sprint review NBW-12', null, 'NBW-12', 'google:c:review-1'],
    ])
  })

  test('an event the user has logged is refused, in this organization or another', async () => {
    await as(member, () =>
      createEntries(db, member, { description: 'Sync', entries: [meeting('google:c:sync-1', 40)] }),
    )
    await expect(
      as(member, () =>
        createEntries(db, member, {
          description: 'Sync',
          entries: [meeting('google:c:sync-1', 40)],
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', key: 'calendar_event_logged' })
    await expect(
      as(memberInHarbor, () =>
        createEntry(db, memberInHarbor, { ...meeting('google:c:sync-1', 40), description: 'Sync' }),
      ),
    ).rejects.toMatchObject({ key: 'calendar_event_logged' })
  })

  test('another user logs the same event key on their own', async () => {
    const lead = await scopeOf(db, U.lead, O.northwind)
    await as(member, () =>
      createEntry(db, member, {
        ...meeting('google:shared:all-hands', 50),
        description: 'All hands',
      }),
    )
    const theirs = await as(lead, () =>
      createEntry(db, lead, {
        ...meeting('google:shared:all-hands', 50),
        description: 'All hands',
      }),
    )
    expect(theirs.calendarEvent).toBe('google:shared:all-hands')
  })

  test('logging an event whose entry was deleted moves the key to the new entry', async () => {
    const first = await as(member, () =>
      createEntry(db, member, { ...meeting('google:c:retro-1', 60), description: 'Retro' }),
    )
    await as(member, () => deleteEntry(db, member, { id: first.id }))
    const again = await as(member, () =>
      createEntry(db, member, { ...meeting('google:c:retro-1', 60), description: 'Retro' }),
    )
    expect(again.calendarEvent).toBe('google:c:retro-1')
    const [old] = await db.select().from(timeEntry).where(eq(timeEntry.id, first.id))
    expect(old.calendarEvent).toBeNull()
  })

  test('the same key twice in one call is refused', async () => {
    await expect(
      as(member, () =>
        createEntries(db, member, {
          description: 'Twice',
          entries: [meeting('google:c:x', 70), meeting('google:c:x', 69)],
        }),
      ),
    ).rejects.toMatchObject({ key: 'calendar_event_logged' })
  })

  test('a second tab logging the same event in between is refused by the unique key', async () => {
    const key = 'google:c:race-1'
    const racing = interleaved(db, /insert into "time_entry"/i, () =>
      as(member, () => createEntry(db, member, { ...meeting(key, 80), description: 'Race' })),
    )
    const error = await as(member, () =>
      createEntry(racing, member, { ...meeting(key, 80), description: 'Race' }),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ code: 'CONFLICT', key: 'calendar_event_logged' })
  })
})
