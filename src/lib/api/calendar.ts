import * as v from 'valibot'
import {
  CalendarAuthorization,
  CalendarEvents,
  Calendars,
  CalendarSource,
  type ConnectCalendarInput,
  type DisconnectCalendarInput,
  type FinishCalendarConnectionInput,
  FinishedCalendarConnection,
  type ListCalendarEventsInput,
  type UpdateCalendarSourceInput,
} from '~/server/calendar/calendar.schemas'
import { request } from './request'

export function getCalendars() {
  return request('GET', '/api/v1/calendar', undefined, Calendars)
}

// The provider's consent page for a new connection; `returnTo` is where the app goes after.
export function connectCalendar(input: v.InferInput<typeof ConnectCalendarInput>) {
  return request('POST', '/api/v1/calendar/connect', input, CalendarAuthorization)
}

// Sends the code the provider gave the callback page.
export function finishCalendarConnection(
  input: v.InferInput<typeof FinishCalendarConnectionInput>,
) {
  return request('POST', '/api/v1/calendar/connections', input, FinishedCalendarConnection)
}

export function disconnectCalendar({ id }: v.InferInput<typeof DisconnectCalendarInput>) {
  return request(
    'DELETE',
    `/api/v1/calendar/connections/${id}`,
    undefined,
    v.object({ id: v.string() }),
  )
}

export function updateCalendarSource({
  id,
  ...input
}: v.InferInput<typeof UpdateCalendarSourceInput>) {
  return request('PATCH', `/api/v1/calendar/sources/${id}`, input, CalendarSource)
}

export function listCalendarEvents({
  organizationId,
  ...range
}: v.InferInput<typeof ListCalendarEventsInput> & { organizationId: string }) {
  return request(
    'POST',
    `/api/v1/organizations/${organizationId}/calendar/events`,
    range,
    CalendarEvents,
  )
}
