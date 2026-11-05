import { createFileRoute } from '@tanstack/solid-router'
import * as v from 'valibot'
import { CalendarCallbackPage } from '~/features/settings/calendars-card/calendar-callback-page'
import { m } from '~/paraglide/messages.js'

export const Route = createFileRoute('/calendar/callback')({
  validateSearch: v.object({
    code: v.optional(v.string()),
    state: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  head: () => ({ meta: [{ title: m.app_name() }] }),
  component: CalendarCallback,
})

function CalendarCallback() {
  const search = Route.useSearch()
  return <CalendarCallbackPage code={search().code} state={search().state} error={search().error} />
}
