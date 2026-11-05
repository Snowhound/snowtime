// The user's calendar connections, which Settings lists and the Timer page reads to show
// meetings. Calendars span organizations, so the key names none.
import { queryOptions } from '@tanstack/solid-query'
import { isServer } from 'solid-js/web'
import { getCalendars } from '~/lib/api/calendar'

export const calendarsQuery = queryOptions({
  queryKey: ['calendars'],
  queryFn: () => getCalendars(),
  // No page waits on it, so a server render doesn't either.
  enabled: !isServer,
})
