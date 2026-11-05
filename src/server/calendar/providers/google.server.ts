// Google Calendar: OAuth 2.0 for web server apps and the Calendar REST API v3, over fetch.
// The only file that knows Google's endpoints and field names.
import { startOfDay } from '~/lib/calendar'
import type { CalendarEvent } from '../calendar.schemas'
import {
  type CalendarAdapter,
  type ProviderCalendar,
  ProviderUnavailable,
  type ProviderTokens,
  TokenRefused,
} from './provider.server'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API_URL = 'https://www.googleapis.com/calendar/v3'

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
]

// The fields events.list sends, so an answer carries nothing the mapping doesn't read.
const EVENT_FIELDS =
  'nextPageToken,items(id,status,summary,start,end,recurringEventId,transparency,eventType,organizer(self),attendees(self,responseStatus))'

interface GoogleTime {
  date?: string
  dateTime?: string
}

export interface GoogleEvent {
  id: string
  status?: string
  summary?: string
  start?: GoogleTime
  end?: GoogleTime
  recurringEventId?: string
  transparency?: string
  eventType?: string
  organizer?: { self?: boolean }
  attendees?: { self?: boolean; responseStatus?: string }[]
}

interface GoogleCalendarListEntry {
  id: string
  summary?: string
  summaryOverride?: string
  backgroundColor?: string
  primary?: boolean
}

const KINDS: Record<string, CalendarEvent['kind']> = {
  default: 'event',
  outOfOffice: 'out_of_office',
  workingLocation: 'working_location',
  focusTime: 'focus_time',
}

const RESPONSES: Record<string, CalendarEvent['response']> = {
  accepted: 'accepted',
  tentative: 'tentative',
  declined: 'declined',
  needsAction: 'none',
}

function eventKey(calendarId: string, eventId: string) {
  return `google:${calendarId}:${eventId}`
}

function response(event: GoogleEvent): CalendarEvent['response'] {
  if (event.organizer?.self) return 'organizer'
  const self = event.attendees?.find((a) => a.self)
  // An event without guests is the user's own.
  if (!self) return 'organizer'
  return RESPONSES[self.responseStatus ?? ''] ?? 'none'
}

function instant(time: GoogleTime, timeZone: string) {
  return time.dateTime ? new Date(time.dateTime) : new Date(startOfDay(time.date!, timeZone))
}

// One occurrence in the shared shape, or null for what Snowtime doesn't show: cancelled
// occurrences, event types it doesn't know (birthdays, Gmail's), and events without times.
export function mapEvent(
  event: GoogleEvent,
  calendarId: string,
  sourceId: string,
  timeZone: string,
): CalendarEvent | null {
  if (event.status === 'cancelled') return null
  const kind = KINDS[event.eventType ?? 'default']
  if (!kind || !event.start || !event.end) return null
  if (!event.start.date && !event.start.dateTime) return null
  const startedAt = instant(event.start, timeZone)
  const stoppedAt = instant(event.end, timeZone)
  if (!(stoppedAt > startedAt)) return null
  return {
    key: eventKey(calendarId, event.id),
    seriesKey: event.recurringEventId ? eventKey(calendarId, event.recurringEventId) : null,
    sourceId,
    title: event.summary?.trim() ?? '',
    startedAt,
    stoppedAt,
    allDay: !!event.start.date,
    free: event.transparency === 'transparent',
    response: response(event),
    kind,
  }
}

async function failure(response: Response, what: string): Promise<never> {
  const text = await response.text().catch(() => '')
  // 401 is an expired or revoked token; 403 here is a scope the user took back.
  if (response.status === 401 || response.status === 403) throw new TokenRefused(`${what}: ${text}`)
  throw new ProviderUnavailable(`${what} answered ${response.status}: ${text}`)
}

async function call(url: string, init: RequestInit, what: string) {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    throw new ProviderUnavailable(`${what}: ${String(error)}`)
  }
  return response
}

function tokens(json: {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}): ProviderTokens {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scope: json.scope ?? '',
  }
}

async function get<T>(accessToken: string, path: string, params: URLSearchParams, what: string) {
  const response = await call(
    `${API_URL}${path}?${params}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
    what,
  )
  if (response.status === 404) return null
  if (!response.ok) await failure(response, what)
  return (await response.json()) as T
}

export function googleCalendar(client: {
  clientId: string
  clientSecret: string
}): CalendarAdapter {
  async function token(body: Record<string, string>, what: string) {
    const response = await call(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.clientId,
          client_secret: client.clientSecret,
          ...body,
        }),
      },
      what,
    )
    // invalid_grant: the code or refresh token is expired, used, or revoked.
    if (response.status === 400 || response.status === 401) {
      throw new TokenRefused(`${what}: ${await response.text().catch(() => '')}`)
    }
    if (!response.ok) await failure(response, what)
    return tokens(await response.json())
  }

  return {
    authorizationUrl({ state, codeChallenge, redirectUri }) {
      const params = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_CALENDAR_SCOPES.join(' '),
        // A refresh token, every time: prompt=consent makes Google send one again when the
        // user connects an account a second time.
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'false',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })
      return `${AUTH_URL}?${params}`
    },

    exchangeCode({ code, codeVerifier, redirectUri }) {
      return token(
        {
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        },
        'Google token exchange',
      )
    },

    hasScopes(scope) {
      const granted = new Set(scope.split(' '))
      return GOOGLE_CALENDAR_SCOPES.every((s) => granted.has(s))
    },

    refresh(refreshToken) {
      return token(
        { grant_type: 'refresh_token', refresh_token: refreshToken },
        'Google token refresh',
      )
    },

    async revoke(token) {
      await call(
        REVOKE_URL,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
        },
        'Google token revoke',
      )
    },

    async listCalendars(accessToken) {
      const calendars: ProviderCalendar[] = []
      let pageToken: string | undefined
      do {
        const params = new URLSearchParams({
          fields: 'nextPageToken,items(id,summary,summaryOverride,backgroundColor,primary)',
          maxResults: '250',
        })
        if (pageToken) params.set('pageToken', pageToken)
        const page = await get<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(
          accessToken,
          '/users/me/calendarList',
          params,
          'Google calendarList.list',
        )
        for (const c of page?.items ?? []) {
          calendars.push({
            id: c.id,
            name: c.summaryOverride ?? c.summary ?? c.id,
            color: c.backgroundColor ?? null,
            primary: !!c.primary,
          })
        }
        pageToken = page?.nextPageToken
      } while (pageToken)
      // The primary calendar's id is the account's address, which the two calendar scopes
      // reveal without asking for the user's profile.
      const primary = calendars.find((c) => c.primary)
      if (!primary)
        throw new ProviderUnavailable('Google calendarList.list has no primary calendar')
      return { account: { id: primary.id, email: primary.id }, calendars }
    },

    async listEvents(accessToken, source, range, timeZone) {
      const events: CalendarEvent[] = []
      let pageToken: string | undefined
      do {
        const params = new URLSearchParams({
          singleEvents: 'true',
          orderBy: 'startTime',
          timeMin: range.from.toISOString(),
          timeMax: range.to.toISOString(),
          maxResults: '2500',
          fields: EVENT_FIELDS,
        })
        for (const type of Object.keys(KINDS)) params.append('eventTypes', type)
        if (pageToken) params.set('pageToken', pageToken)
        const page = await get<{ items?: GoogleEvent[]; nextPageToken?: string }>(
          accessToken,
          `/calendars/${encodeURIComponent(source.providerCalendarId)}/events`,
          params,
          'Google events.list',
        )
        for (const item of page?.items ?? []) {
          const event = mapEvent(item, source.providerCalendarId, source.sourceId, timeZone)
          if (event) events.push(event)
        }
        pageToken = page?.nextPageToken
      } while (pageToken)
      return events
    },
  }
}
