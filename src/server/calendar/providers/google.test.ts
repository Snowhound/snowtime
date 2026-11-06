/// <reference types="bun" />

import { afterEach, describe, expect, test } from 'bun:test'
import { GOOGLE_CALENDAR_SCOPES, type GoogleEvent, googleCalendar, mapEvent } from './google.server'
import { ProviderUnavailable, TokenRefused } from './provider.server'

const CAL = 'anna@snowhound.eu'
const SOURCE = '0190a000-0000-7000-8000-000000000001'

function map(event: Partial<GoogleEvent>, timeZone = 'Europe/Tallinn') {
  return mapEvent(
    {
      id: 'ev1',
      summary: 'Standup',
      start: { dateTime: '2026-11-03T09:30:00+02:00' },
      end: { dateTime: '2026-11-03T09:45:00+02:00' },
      ...event,
    },
    CAL,
    SOURCE,
    timeZone,
  )
}

describe('mapEvent', () => {
  test('a timed event keeps its instants, whatever zone its offset names', () => {
    const e = map({
      start: { dateTime: '2026-11-03T02:30:00-05:00' },
      end: { dateTime: '2026-11-03T03:00:00-05:00' },
    })
    expect(e).toMatchObject({
      key: `google:${CAL}:ev1`,
      seriesKey: null,
      sourceId: SOURCE,
      title: 'Standup',
      startedAt: new Date('2026-11-03T07:30:00Z'),
      stoppedAt: new Date('2026-11-03T08:00:00Z'),
      allDay: false,
      free: false,
      response: 'organizer',
      kind: 'event',
    })
  })

  test('an occurrence of a series carries the series key', () => {
    const e = map({ id: 'standup_20261103T073000Z', recurringEventId: 'standup' })
    expect(e?.key).toBe(`google:${CAL}:standup_20261103T073000Z`)
    expect(e?.seriesKey).toBe(`google:${CAL}:standup`)
  })

  test("an all-day event runs from midnight to midnight in the user's zone", () => {
    const tallinn = map({ start: { date: '2026-11-12' }, end: { date: '2026-11-14' } })
    expect(tallinn).toMatchObject({
      allDay: true,
      startedAt: new Date('2026-11-11T22:00:00Z'),
      stoppedAt: new Date('2026-11-13T22:00:00Z'),
    })
    const tokyo = map({ start: { date: '2026-11-12' }, end: { date: '2026-11-13' } }, 'Asia/Tokyo')
    expect(tokyo?.startedAt).toEqual(new Date('2026-11-11T15:00:00Z'))
  })

  test("the user's answer: declined, maybe, unanswered, and the organizer's own", () => {
    function attendees(responseStatus: string) {
      return [{ self: true, responseStatus }, { responseStatus: 'accepted' }]
    }
    expect(map({ attendees: attendees('declined') })?.response).toBe('declined')
    expect(map({ attendees: attendees('tentative') })?.response).toBe('tentative')
    expect(map({ attendees: attendees('needsAction') })?.response).toBe('none')
    expect(map({ attendees: attendees('accepted') })?.response).toBe('accepted')
    expect(map({ organizer: { self: true }, attendees: attendees('accepted') })?.response).toBe(
      'organizer',
    )
  })

  test('shown as free, out of office, focus time, and working location', () => {
    expect(map({ transparency: 'transparent' })?.free).toBe(true)
    expect(map({ eventType: 'outOfOffice' })?.kind).toBe('out_of_office')
    expect(map({ eventType: 'focusTime' })?.kind).toBe('focus_time')
    expect(map({ eventType: 'workingLocation' })?.kind).toBe('working_location')
  })

  test('cancelled occurrences, unknown event types, and events without times are left out', () => {
    expect(map({ status: 'cancelled' })).toBeNull()
    expect(map({ eventType: 'birthday' })).toBeNull()
    expect(map({ start: {}, end: {} })).toBeNull()
  })

  test('an event without a title has an empty one', () => {
    expect(map({ summary: undefined })?.title).toBe('')
  })
})

describe('googleCalendar', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })
  const google = googleCalendar({ clientId: 'client', clientSecret: 'secret' })

  function respond(handler: (url: URL, init?: RequestInit) => Response) {
    const calls: { url: URL; init?: RequestInit }[] = []
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      calls.push({ url, init })
      return handler(url, init)
    }) as typeof fetch
    return calls
  }

  test('asks for the two calendar scopes, offline, with PKCE', () => {
    const url = new URL(
      google.authorizationUrl({
        state: 's',
        codeChallenge: 'c',
        redirectUri: 'http://localhost:3100/calendar/callback',
      }),
    )
    expect(url.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_SCOPES.join(' '))
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3100/calendar/callback')
  })

  test('a granted scope list must hold both scopes', () => {
    expect(google.hasScopes(GOOGLE_CALENDAR_SCOPES.join(' '))).toBe(true)
    expect(google.hasScopes(GOOGLE_CALENDAR_SCOPES[0])).toBe(false)
  })

  test('a refresh Google refuses is TokenRefused; one it fails to answer is not', async () => {
    respond(() => Response.json({ error: 'invalid_grant' }, { status: 400 }))
    await expect(google.refresh('old')).rejects.toBeInstanceOf(TokenRefused)
    respond(() => new Response('', { status: 503 }))
    await expect(google.refresh('old')).rejects.toBeInstanceOf(ProviderUnavailable)
  })

  test('a refresh answers the new access token and when it expires', async () => {
    const calls = respond(() =>
      Response.json({ access_token: 'new', expires_in: 3600, scope: 'x' }),
    )
    const before = Date.now()
    const tokens = await google.refresh('refresh')
    expect(tokens.accessToken).toBe('new')
    expect(tokens.refreshToken).toBeUndefined()
    expect(tokens.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3_600_000)
    expect((calls[0].init!.body as URLSearchParams).toString()).toContain(
      'grant_type=refresh_token',
    )
  })

  test('lists the events of every page as occurrences, with the event types it maps', async () => {
    const calls = respond((url) =>
      url.searchParams.get('pageToken')
        ? Response.json({
            items: [
              {
                id: 'b',
                summary: 'Two',
                start: { date: '2026-11-04' },
                end: { date: '2026-11-05' },
              },
            ],
          })
        : Response.json({
            nextPageToken: 'p2',
            items: [
              {
                id: 'a',
                summary: 'One',
                start: { dateTime: '2026-11-03T10:00:00Z' },
                end: { dateTime: '2026-11-03T11:00:00Z' },
              },
              { id: 'c', status: 'cancelled' },
            ],
          }),
    )
    const events = await google.listEvents(
      'token',
      { sourceId: SOURCE, providerCalendarId: 'team#calendar@group.calendar.google.com' },
      { from: new Date('2026-11-02T00:00:00Z'), to: new Date('2026-11-09T00:00:00Z') },
      'UTC',
    )
    expect(events.map((e) => e.title)).toEqual(['One', 'Two'])
    expect(calls[0].url.pathname).toBe(
      '/calendar/v3/calendars/team%23calendar%40group.calendar.google.com/events',
    )
    expect(calls[0].url.searchParams.get('singleEvents')).toBe('true')
    expect(calls[0].url.searchParams.getAll('eventTypes')).toEqual([
      'default',
      'outOfOffice',
      'workingLocation',
      'focusTime',
    ])
    expect((calls[0].init!.headers as Record<string, string>).authorization).toBe('Bearer token')
  })

  test('an access token Google refuses on a read is TokenRefused', async () => {
    respond(() => new Response('', { status: 401 }))
    await expect(
      google.listEvents(
        'token',
        { sourceId: SOURCE, providerCalendarId: CAL },
        { from: new Date(0), to: new Date(1) },
        'UTC',
      ),
    ).rejects.toBeInstanceOf(TokenRefused)
  })

  test('the account is the primary calendar, whose id is its address', async () => {
    respond(() =>
      Response.json({
        items: [
          { id: 'team@group.calendar.google.com', summary: 'Team', backgroundColor: '#33b679' },
          { id: CAL, summary: CAL, backgroundColor: '#039be5', primary: true },
        ],
      }),
    )
    const { account, calendars } = await google.listCalendars('token')
    expect(account).toEqual({ id: CAL, email: CAL })
    expect(calendars).toContainEqual({
      id: 'team@group.calendar.google.com',
      name: 'Team',
      color: '#33b679',
      primary: false,
    })
  })
})
