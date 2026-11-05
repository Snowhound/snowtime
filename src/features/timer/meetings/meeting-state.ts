// The calendar events of a range, and what the user did with each, for the views that show
// them beside the entries: the week calendar and the list.
import { keepPreviousData, useQueryClient } from '@tanstack/solid-query'
import { createMemo } from 'solid-js'
import type { Range } from '~/lib/calendar'
import type { Region } from '~/lib/holidays/holidays'
import { calendarsQuery } from '~/lib/queries/calendar'
import { useQuery } from '~/lib/queries/use-query'
import type { CalendarEvent } from '~/server/calendar/calendar.schemas'
import type { Entry } from '../queries'
import { connectionNeedsReconnect, dayLogs, logState, timedLog } from './meetings'
import { calendarEventsQuery } from './queries'

export function createMeetingState(props: {
  organizationId: string
  range: () => Range
  // The loaded entries, whose keys count as logged here.
  entries: () => readonly Entry[]
  zone: () => string
  region: () => Region
}) {
  const calendars = useQuery(() => calendarsQuery)
  function connected() {
    return !!calendars.data?.available && (calendars.data?.connections.length ?? 0) > 0
  }
  const events = useQuery(() => ({
    ...calendarEventsQuery(props.organizationId, props.range()),
    enabled: connected(),
    placeholderData: keepPreviousData,
  }))
  const entryKeys = createMemo(
    () => new Set(props.entries().flatMap((e) => (e.calendarEvent ? [e.calendarEvent] : []))),
  )
  function stateOf(key: string) {
    return logState(key, entryKeys(), events.data?.logs ?? [], props.organizationId)
  }
  function shownEvents() {
    return connected() ? (events.data?.events ?? []) : []
  }
  function loggablesOf(event: CalendarEvent) {
    return event.allDay ? dayLogs(event, props.zone(), props.region()) : [timedLog(event)]
  }
  function sourceOf(event: { sourceId: string }) {
    return calendars.data?.connections
      .flatMap((c) => c.sources)
      .find((s) => s.id === event.sourceId)
  }
  // A dot in the calendar's color tells calendars apart once more than one shows.
  function dotOf(event: { sourceId: string }) {
    const shown = calendars.data?.connections.flatMap((c) => c.sources).filter((s) => s.shown)
    return shown && shown.length > 1 ? (sourceOf(event)?.color ?? null) : null
  }
  function needsReconnect() {
    return (
      connectionNeedsReconnect(events.data) ||
      !!calendars.data?.connections.some((c) => c.status === 'reconnect')
    )
  }
  // The events are read again after a log or its Undo, for the keys' new state.
  const queryClient = useQueryClient()
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['calendar-events', props.organizationId] })
  }
  return {
    connected,
    events,
    entryKeys,
    stateOf,
    shownEvents,
    loggablesOf,
    sourceOf,
    dotOf,
    needsReconnect,
    refresh,
  }
}
