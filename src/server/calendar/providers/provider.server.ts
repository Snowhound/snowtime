// What an adapter does for the calendar rules. Each provider maps its API to these shapes,
// and nothing outside its adapter knows its field names (task 097, "Provider-neutral design").
import type { CalendarEvent } from '../calendar.schemas'

export interface ProviderTokens {
  accessToken: string
  // Absent when the provider keeps the refresh token it gave before.
  refreshToken?: string
  expiresAt: Date
  scope: string
}

export interface ProviderCalendar {
  id: string
  name: string
  color: string | null
  primary: boolean
}

interface ProviderAccount {
  id: string
  email: string
}

// A calendar of a connection, as the rules ask for its events.
interface EventSource {
  sourceId: string
  providerCalendarId: string
}

export interface CalendarAdapter {
  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string
  exchangeCode(input: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<ProviderTokens>
  // Whether the user granted every scope the integration needs.
  hasScopes(scope: string): boolean
  refresh(refreshToken: string): Promise<ProviderTokens>
  revoke(token: string): Promise<void>
  listCalendars(
    accessToken: string,
  ): Promise<{ account: ProviderAccount; calendars: ProviderCalendar[] }>
  // Occurrences overlapping [from, to); all-day events in `timeZone`.
  listEvents(
    accessToken: string,
    source: EventSource,
    range: { from: Date; to: Date },
    timeZone: string,
  ): Promise<CalendarEvent[]>
}

// The provider refused the token: refreshing failed, or the access was revoked. The
// connection needs the user to connect again.
export class TokenRefused extends Error {
  constructor(message = 'The calendar provider refused the token.') {
    super(message)
    this.name = 'TokenRefused'
  }
}

// The provider didn't answer, or answered with an error that isn't about the token.
export class ProviderUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderUnavailable'
  }
}
