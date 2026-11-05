import { Hono } from 'hono'
import { input, type OrganizationEnv, reads, run, type UserEnv } from '../http.server'
import {
  ConnectCalendarInput,
  DisconnectCalendarInput,
  FinishCalendarConnectionInput,
  ListCalendarEventsInput,
  UpdateCalendarSourceInput,
} from './calendar.schemas'
import * as calendar from './calendar.server'

// A user's calendars span organizations, so connecting and choosing them name none. App-only
// calls: no route takes an API key.
export const calendarRoutes = new Hono<UserEnv>()
  .get('/calendar', (c) => run(c, calendar.getCalendars))
  .post('/calendar/connect', input(ConnectCalendarInput), (c) => run(c, calendar.connectCalendar))
  .post('/calendar/connections', input(FinishCalendarConnectionInput), (c) =>
    run(c, calendar.finishCalendarConnection),
  )
  .delete('/calendar/connections/:id', input(DisconnectCalendarInput), (c) =>
    run(c, calendar.disconnectCalendar),
  )
  .patch('/calendar/sources/:id', input(UpdateCalendarSourceInput), (c) =>
    run(c, calendar.updateCalendarSource),
  )

// Reading events names the organization, for the entries logged from them.
export const organizationCalendarRoutes = new Hono<OrganizationEnv>().post(
  '/calendar/events',
  reads,
  input(ListCalendarEventsInput),
  (c) => run(c, calendar.listCalendarEvents),
)
