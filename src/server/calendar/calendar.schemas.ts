// The calendar calls (task 097): connecting a calendar account, choosing its calendars, and
// reading their events. Nothing here names a provider's API; each provider's adapter maps
// its own shapes to these (src/server/calendar/providers/).
import * as v from 'valibot'
import { Timestamp, Uuidv7, keyed } from '../schemas'

export const CALENDAR_PROVIDERS = ['google'] as const
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number]

// `reconnect` once the provider refused to refresh the access token: the user connects
// again, and nothing else fails.
export const CALENDAR_CONNECTION_STATUSES = ['connected', 'reconnect'] as const

// The longest range one read of events covers, as listEntries allows.
export const MAX_EVENT_DAYS = 93

// An event's key, which the adapter builds from the provider's stable ids with the provider
// and calendar in it. An entry carries it in `calendarEvent`; an all-day event logged as a
// day adds `:<date>` (allDayKey).
export const CalendarEventKey = v.pipe(
  v.string(),
  v.regex(/^[a-z]+:\S+$/, keyed('validation_invalid')),
  v.maxLength(
    1024,
    keyed('validation_too_long', (issue) => ({ max: Number(issue.requirement) })),
  ),
)

export function allDayKey(eventKey: string, date: string) {
  return `${eventKey}:${date}`
}

const EVENT_RESPONSES = ['organizer', 'accepted', 'tentative', 'none', 'declined'] as const
const EVENT_KINDS = ['event', 'out_of_office', 'working_location', 'focus_time'] as const

// One occurrence: a recurring series arrives as its occurrences. An all-day event runs from
// midnight of its first day to midnight after its last, in the user's time zone.
export const CalendarEvent = v.object({
  key: v.string(),
  seriesKey: v.nullable(v.string()),
  sourceId: v.string(),
  title: v.string(),
  startedAt: Timestamp,
  stoppedAt: Timestamp,
  allDay: v.boolean(),
  free: v.boolean(),
  response: v.picklist(EVENT_RESPONSES),
  kind: v.picklist(EVENT_KINDS),
})
export type CalendarEvent = v.InferOutput<typeof CalendarEvent>

export const CalendarSource = v.object({
  id: v.string(),
  name: v.string(),
  color: v.nullable(v.string()),
  primary: v.boolean(),
  shown: v.boolean(),
})
export type CalendarSource = v.InferOutput<typeof CalendarSource>

// A connected account. Its tokens never leave the server.
export const CalendarConnection = v.object({
  id: v.string(),
  provider: v.picklist(CALENDAR_PROVIDERS),
  accountEmail: v.string(),
  status: v.picklist(CALENDAR_CONNECTION_STATUSES),
  connectedAt: Timestamp,
  sources: v.array(CalendarSource),
})
export type CalendarConnection = v.InferOutput<typeof CalendarConnection>

// `available` is false when the deployment has no provider set up, and the app hides the
// feature.
export const Calendars = v.object({
  available: v.boolean(),
  connections: v.array(CalendarConnection),
})
export type Calendars = v.InferOutput<typeof Calendars>

// Where the app goes after the provider sends the user back: a path of this app.
export const ConnectCalendarInput = v.object({
  returnTo: v.pipe(
    v.string(),
    v.regex(/^\/(?![/\\])/, keyed('validation_invalid')),
    v.maxLength(512),
  ),
})
export type ConnectCalendarInput = v.InferOutput<typeof ConnectCalendarInput>

// The provider's consent page, which the browser opens.
export const CalendarAuthorization = v.object({ url: v.string() })

// What the provider sends back to the app's callback page.
export const FinishCalendarConnectionInput = v.object({
  code: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
  state: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
})
export type FinishCalendarConnectionInput = v.InferOutput<typeof FinishCalendarConnectionInput>

export const FinishedCalendarConnection = v.object({
  returnTo: v.string(),
  connection: CalendarConnection,
})

export const UpdateCalendarSourceInput = v.object({ id: Uuidv7, shown: v.boolean() })
export type UpdateCalendarSourceInput = v.InferOutput<typeof UpdateCalendarSourceInput>

export const DisconnectCalendarInput = v.object({ id: Uuidv7 })
export type DisconnectCalendarInput = v.InferOutput<typeof DisconnectCalendarInput>

// Events starting before `to` and ending after `from`.
export const ListCalendarEventsInput = v.pipe(
  v.object({ from: Timestamp, to: Timestamp }),
  v.check((i) => i.to > i.from, keyed('validation_range_end_before_start')),
  v.check(
    (i) => i.to.getTime() - i.from.getTime() <= MAX_EVENT_DAYS * 86_400_000,
    keyed('validation_range_too_long', () => ({ days: MAX_EVENT_DAYS })),
  ),
)
export type ListCalendarEventsInput = v.InferOutput<typeof ListCalendarEventsInput>

// An entry of the user's that carries one of the read events' keys, in any organization,
// deleted ones included: a key is logged once per user.
export const CalendarLog = v.object({
  calendarEvent: v.string(),
  entryId: v.string(),
  organizationId: v.string(),
  deleted: v.boolean(),
})
export type CalendarLog = v.InferOutput<typeof CalendarLog>

export const CalendarEvents = v.object({
  events: v.array(CalendarEvent),
  logs: v.array(CalendarLog),
  connections: v.array(
    v.object({ id: v.string(), status: v.picklist(CALENDAR_CONNECTION_STATUSES) }),
  ),
})
export type CalendarEvents = v.InferOutput<typeof CalendarEvents>
