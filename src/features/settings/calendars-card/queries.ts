// The Calendars card's mutations. Connecting leaves the page for the provider's consent page,
// so it has no cache to update; the callback page's finish fills it.
import { useMutation, useQueryClient } from '@tanstack/solid-query'
import {
  connectCalendar,
  disconnectCalendar,
  finishCalendarConnection,
  updateCalendarSource,
} from '~/lib/api/calendar'
import { calendarsQuery } from '~/lib/queries/calendar'
import { cacheUpdate, optimistic } from '~/lib/queries/query'
import type { Calendars, UpdateCalendarSourceInput } from '~/server/calendar/calendar.schemas'

// The events every week showed came from the calendars shown then.
const eventsKey = ['calendar-events']

export function useConnectCalendar() {
  return useMutation(() => ({
    mutationFn: (returnTo: string) => connectCalendar({ returnTo }),
    onSuccess: ({ url }) => location.assign(url),
  }))
}

export function useFinishCalendarConnection() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: finishCalendarConnection,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: calendarsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: eventsKey }),
      ]),
  }))
}

export function useUpdateCalendarSource() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: UpdateCalendarSourceInput) => updateCalendarSource(input),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Calendars, UpdateCalendarSourceInput>(
          calendarsQuery.queryKey,
          (data, input) => ({
            ...data,
            connections: data.connections.map((c) => ({
              ...c,
              sources: c.sources.map((s) => (s.id === input.id ? { ...s, shown: input.shown } : s)),
            })),
          }),
        ),
      ],
      { invalidate: [eventsKey] },
    ),
  }))
}

export function useDisconnectCalendar() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (id: string) => disconnectCalendar({ id }),
    ...optimistic(
      queryClient,
      [
        cacheUpdate<Calendars, string>(calendarsQuery.queryKey, (data, id) => ({
          ...data,
          connections: data.connections.filter((c) => c.id !== id),
        })),
      ],
      { invalidate: [eventsKey] },
    ),
  }))
}
