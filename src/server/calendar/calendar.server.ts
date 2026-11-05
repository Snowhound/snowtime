// A user's calendar connections and their events (task 097). Calendars belong to the user,
// so connecting and choosing calendars name no organization; reading events does, for the
// entries already logged from them. Events are read from the provider on each call and never
// stored (docs/architecture/calendar.md).
import { and, eq, inArray } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '~/db'
import { calendarConnection, calendarSource, timeEntry, userSettings } from '~/db/schema'
import { env, appUrl } from '~/env'
import { addDays, localDate } from '~/lib/calendar'
import { AppError } from '../errors'
import type { Scope } from '../scope.server'
import {
  allDayKey,
  type CalendarConnection,
  type CalendarEvent,
  type CalendarEvents,
  type CalendarProvider,
  type Calendars,
  type ConnectCalendarInput,
  type DisconnectCalendarInput,
  type FinishCalendarConnectionInput,
  type ListCalendarEventsInput,
  type UpdateCalendarSourceInput,
} from './calendar.schemas'
import { googleCalendar } from './providers/google.server'
import {
  type CalendarAdapter,
  ProviderUnavailable,
  type ProviderTokens,
  TokenRefused,
} from './providers/provider.server'
import { pkce, seal, unseal } from './tokens.server'

// The providers this deployment has a client for. Google's is the sign-in client, with the
// calendar's own redirect URL. Tests put a fake adapter here.
export const adapters: Partial<Record<CalendarProvider, CalendarAdapter>> = {}
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  adapters.google = googleCalendar({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  })
}

// The app's page the provider sends the user back to (src/routes/calendar.callback.tsx).
function redirectUri() {
  return new URL('/calendar/callback', appUrl).toString()
}

const STATE_TTL_MS = 10 * 60_000
// An access token this close to expiring is refreshed before a call.
const REFRESH_MARGIN_MS = 60_000

interface State {
  userId: string
  provider: CalendarProvider
  verifier: string
  returnTo: string
  expiresAt: number
}

function adapterFor(provider: CalendarProvider) {
  const adapter = adapters[provider]
  if (!adapter) throw new AppError('NOT_FOUND', 'calendar_unavailable')
  return adapter
}

// The provider a new connection uses: Google, the only one so far.
function defaultProvider(): CalendarProvider {
  if (!adapters.google) throw new AppError('NOT_FOUND', 'calendar_unavailable')
  return 'google'
}

function unavailable(error: unknown): never {
  if (error instanceof ProviderUnavailable) {
    throw new AppError('UNAVAILABLE', 'calendar_provider_unavailable')
  }
  throw error
}

async function connections(db: Database, userId: string): Promise<CalendarConnection[]> {
  const rows = await db
    .select({
      id: calendarConnection.id,
      provider: calendarConnection.provider,
      accountEmail: calendarConnection.accountEmail,
      status: calendarConnection.status,
      connectedAt: calendarConnection.createdAt,
    })
    .from(calendarConnection)
    .where(eq(calendarConnection.userId, userId))
    .orderBy(calendarConnection.createdAt)
  if (!rows.length) return []
  const sources = await db
    .select({
      id: calendarSource.id,
      connectionId: calendarSource.connectionId,
      name: calendarSource.name,
      color: calendarSource.color,
      primary: calendarSource.isPrimary,
      shown: calendarSource.shown,
    })
    .from(calendarSource)
    .where(
      inArray(
        calendarSource.connectionId,
        rows.map((r) => r.id),
      ),
    )
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    accountEmail: row.accountEmail,
    status: row.status,
    connectedAt: row.connectedAt,
    sources: sources
      .filter((s) => s.connectionId === row.id)
      .map((s) => ({ id: s.id, name: s.name, color: s.color, primary: s.primary, shown: s.shown }))
      // The primary calendar first, then by name.
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name)),
  }))
}

export async function getCalendars(db: Database, userId: string): Promise<Calendars> {
  return { available: !!adapters.google, connections: await connections(db, userId) }
}

// Starts the provider's consent flow. The state carries, sealed, who asked, where to return,
// and the PKCE verifier, so the callback needs no row of its own.
export async function connectCalendar(_db: Database, userId: string, input: ConnectCalendarInput) {
  const provider = defaultProvider()
  const { verifier, challenge } = await pkce()
  const state: State = {
    userId,
    provider,
    verifier,
    returnTo: input.returnTo,
    expiresAt: Date.now() + STATE_TTL_MS,
  }
  return {
    url: adapterFor(provider).authorizationUrl({
      state: await seal('calendar-state', JSON.stringify(state)),
      codeChallenge: challenge,
      redirectUri: redirectUri(),
    }),
  }
}

async function readState(userId: string, sealed: string): Promise<State> {
  const text = await unseal('calendar-state', sealed)
  const state = text ? (JSON.parse(text) as State) : null
  // A state from another user's browser session is refused too, so a link can't connect
  // someone else's calendar to the signed-in user.
  if (!state || state.userId !== userId || state.expiresAt < Date.now()) {
    throw new AppError('INVALID', 'calendar_state_invalid')
  }
  return state
}

// The callback page sends the provider's code. Connecting an account again updates its row
// and keeps the user's choices of calendars.
export async function finishCalendarConnection(
  db: Database,
  userId: string,
  input: FinishCalendarConnectionInput,
) {
  const state = await readState(userId, input.state)
  const adapter = adapterFor(state.provider)
  let tokens: ProviderTokens
  try {
    tokens = await adapter.exchangeCode({
      code: input.code,
      codeVerifier: state.verifier,
      redirectUri: redirectUri(),
    })
  } catch (error) {
    if (error instanceof TokenRefused) throw new AppError('INVALID', 'calendar_state_invalid')
    unavailable(error)
  }
  if (!adapter.hasScopes(tokens.scope)) {
    await adapter.revoke(tokens.accessToken).catch(() => {})
    throw new AppError('INVALID', 'calendar_scopes_missing')
  }
  const listed = await adapter.listCalendars(tokens.accessToken).catch(unavailable)

  const [existing] = await db
    .select({ id: calendarConnection.id, refreshToken: calendarConnection.refreshToken })
    .from(calendarConnection)
    .where(
      and(
        eq(calendarConnection.userId, userId),
        eq(calendarConnection.provider, state.provider),
        eq(calendarConnection.accountId, listed.account.id),
      ),
    )
  const refreshToken = tokens.refreshToken
    ? await seal('calendar-token', tokens.refreshToken)
    : existing?.refreshToken
  if (!refreshToken) throw new AppError('INVALID', 'calendar_scopes_missing')
  const sealed = {
    accountEmail: listed.account.email,
    accessToken: await seal('calendar-token', tokens.accessToken),
    refreshToken,
    accessTokenExpiresAt: tokens.expiresAt,
    scope: tokens.scope,
    status: 'connected' as const,
  }

  const connectionId = existing?.id ?? uuidv7()
  await db.transaction(async (tx) => {
    if (existing) {
      await tx.update(calendarConnection).set(sealed).where(eq(calendarConnection.id, existing.id))
    } else {
      await tx.insert(calendarConnection).values({
        id: connectionId,
        userId,
        provider: state.provider,
        accountId: listed.account.id,
        ...sealed,
      })
    }
    const known = await tx
      .select({ id: calendarSource.id, providerCalendarId: calendarSource.providerCalendarId })
      .from(calendarSource)
      .where(eq(calendarSource.connectionId, connectionId))
    const byProviderId = new Map(known.map((s) => [s.providerCalendarId, s.id]))
    const listedIds = new Set(listed.calendars.map((c) => c.id))
    const gone = known.filter((s) => !listedIds.has(s.providerCalendarId)).map((s) => s.id)
    if (gone.length) await tx.delete(calendarSource).where(inArray(calendarSource.id, gone))
    for (const c of listed.calendars) {
      const id = byProviderId.get(c.id)
      if (id) {
        await tx
          .update(calendarSource)
          .set({ name: c.name, color: c.color, isPrimary: c.primary })
          .where(eq(calendarSource.id, id))
      } else {
        // A new account shows its primary calendar; the user picks the rest in Settings.
        await tx.insert(calendarSource).values({
          id: uuidv7(),
          connectionId,
          providerCalendarId: c.id,
          name: c.name,
          color: c.color,
          isPrimary: c.primary,
          shown: c.primary,
        })
      }
    }
  })
  const connection = (await connections(db, userId)).find((c) => c.id === connectionId)!
  return { returnTo: state.returnTo, connection }
}

export async function updateCalendarSource(
  db: Database,
  userId: string,
  input: UpdateCalendarSourceInput,
) {
  const [source] = await db
    .select({ id: calendarSource.id })
    .from(calendarSource)
    .innerJoin(calendarConnection, eq(calendarConnection.id, calendarSource.connectionId))
    .where(and(eq(calendarSource.id, input.id), eq(calendarConnection.userId, userId)))
  if (!source) throw new AppError('NOT_FOUND', 'calendar_source_not_found')
  const [updated] = await db
    .update(calendarSource)
    .set({ shown: input.shown })
    .where(eq(calendarSource.id, input.id))
    .returning({
      id: calendarSource.id,
      name: calendarSource.name,
      color: calendarSource.color,
      primary: calendarSource.isPrimary,
      shown: calendarSource.shown,
    })
  return updated
}

// Revokes the token at the provider and deletes the connection and its sources. Entries keep
// their keys, so reconnecting keeps what was logged and deleted. A revoke the provider
// doesn't answer still disconnects: the token is gone from Snowtime either way.
export async function disconnectCalendar(
  db: Database,
  userId: string,
  input: DisconnectCalendarInput,
) {
  const [connection] = await db
    .select()
    .from(calendarConnection)
    .where(and(eq(calendarConnection.id, input.id), eq(calendarConnection.userId, userId)))
  if (!connection) throw new AppError('NOT_FOUND', 'calendar_connection_not_found')
  const refreshToken = await unseal('calendar-token', connection.refreshToken)
  const adapter = adapters[connection.provider]
  if (adapter && refreshToken) await adapter.revoke(refreshToken).catch(() => {})
  await db.delete(calendarConnection).where(eq(calendarConnection.id, connection.id))
  return { id: connection.id }
}

type ConnectionRow = typeof calendarConnection.$inferSelect

async function markReconnect(db: Database, connectionId: string) {
  await db
    .update(calendarConnection)
    .set({ status: 'reconnect' })
    .where(eq(calendarConnection.id, connectionId))
  return null
}

// A usable access token, refreshed when it is about to expire. A refresh the provider
// refuses, or a token sealed under an older secret, sets the connection to `reconnect` and
// answers null.
async function accessToken(db: Database, connection: ConnectionRow, adapter: CalendarAdapter) {
  if (connection.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()) {
    const token = await unseal('calendar-token', connection.accessToken)
    if (token) return token
  }
  const refreshToken = await unseal('calendar-token', connection.refreshToken)
  if (!refreshToken) return markReconnect(db, connection.id)
  let tokens: ProviderTokens
  try {
    tokens = await adapter.refresh(refreshToken)
  } catch (error) {
    if (error instanceof TokenRefused) return markReconnect(db, connection.id)
    return unavailable(error)
  }
  await db
    .update(calendarConnection)
    .set({
      accessToken: await seal('calendar-token', tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      ...(tokens.refreshToken
        ? { refreshToken: await seal('calendar-token', tokens.refreshToken) }
        : {}),
    })
    .where(eq(calendarConnection.id, connection.id))
  return tokens.accessToken
}

async function userTimeZone(db: Database, userId: string) {
  const [settings] = await db
    .select({ timeZone: userSettings.timeZone })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  return settings?.timeZone ?? 'UTC'
}

// The keys an event's entries can carry: its own, and for an all-day event one per day.
export function logKeys(event: CalendarEvent, timeZone: string): string[] {
  if (!event.allDay) return [event.key]
  const keys = []
  const last = localDate(event.stoppedAt.getTime() - 1, timeZone)
  for (let d = localDate(event.startedAt.getTime(), timeZone); d <= last; d = addDays(d, 1)) {
    keys.push(allDayKey(event.key, d))
  }
  return keys
}

// The shown calendars' events in the range, with the user's entries that carry their keys.
// A connection that needs reconnecting adds no events, and the others still answer.
export async function listCalendarEvents(
  db: Database,
  scope: Scope,
  input: ListCalendarEventsInput,
): Promise<CalendarEvents> {
  const [rows, sources, timeZone] = await Promise.all([
    db.select().from(calendarConnection).where(eq(calendarConnection.userId, scope.userId)),
    db
      .select({
        id: calendarSource.id,
        connectionId: calendarSource.connectionId,
        providerCalendarId: calendarSource.providerCalendarId,
      })
      .from(calendarSource)
      .innerJoin(calendarConnection, eq(calendarConnection.id, calendarSource.connectionId))
      .where(and(eq(calendarConnection.userId, scope.userId), eq(calendarSource.shown, true))),
    userTimeZone(db, scope.userId),
  ])

  const statuses = await Promise.all(
    rows.map(async (connection) => {
      const adapter = adapters[connection.provider]
      if (!adapter || connection.status === 'reconnect') {
        return { id: connection.id, status: 'reconnect' as const, events: [] }
      }
      const token = await accessToken(db, connection, adapter)
      if (!token) return { id: connection.id, status: 'reconnect' as const, events: [] }
      try {
        const lists = await Promise.all(
          sources
            .filter((s) => s.connectionId === connection.id)
            .map((s) =>
              adapter.listEvents(
                token,
                { sourceId: s.id, providerCalendarId: s.providerCalendarId },
                input,
                timeZone,
              ),
            ),
        )
        return { id: connection.id, status: 'connected' as const, events: lists.flat() }
      } catch (error) {
        if (!(error instanceof TokenRefused)) unavailable(error)
        await markReconnect(db, connection.id)
        return { id: connection.id, status: 'reconnect' as const, events: [] }
      }
    }),
  )

  const events = statuses
    .flatMap((s) => s.events)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  const keys = [...new Set(events.flatMap((e) => logKeys(e, timeZone)))]
  const logs = keys.length
    ? await db
        .select({
          calendarEvent: timeEntry.calendarEvent,
          entryId: timeEntry.id,
          organizationId: timeEntry.organizationId,
          deleted: timeEntry.sysDeleted,
        })
        .from(timeEntry)
        .where(and(eq(timeEntry.userId, scope.userId), inArray(timeEntry.calendarEvent, keys)))
    : []
  return {
    events,
    logs: logs.map((l) => ({ ...l, calendarEvent: l.calendarEvent! })),
    connections: statuses.map(({ id, status }) => ({ id, status })),
  }
}
