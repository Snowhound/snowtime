// A week's or a range's calendar events. They come from the provider on each read and are
// never stored, so the cache is the only copy; a minute's staleness spares the provider a
// read on every week flip.
import { queryOptions } from '@tanstack/solid-query'
import { isServer } from 'solid-js/web'
import { listCalendarEvents } from '~/lib/api/calendar'
import type { Range } from '~/lib/calendar'

export function calendarEventsQuery(organizationId: string, range: Range) {
  return queryOptions({
    queryKey: ['calendar-events', organizationId, range.from, range.to],
    queryFn: () =>
      listCalendarEvents({ organizationId, from: new Date(range.from), to: new Date(range.to) }),
    staleTime: 60_000,
    enabled: !isServer,
  })
}
