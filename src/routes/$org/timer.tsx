import { createFileRoute } from '@tanstack/solid-router'
import { RECENT_DAYS, recentRange } from '~/features/timer/entries'
import { entriesQuery, firstEntryQuery } from '~/features/timer/queries'
import { TimerPage } from '~/features/timer/timer-page'
import { TimerPending } from '~/features/timer/timer-pending'
import { localDate, weekRange } from '~/lib/calendar'
import { projectsQuery } from '~/lib/queries/projects'
import { runningTimerQuery } from '~/lib/queries/timer'
import { m } from '~/paraglide/messages.js'

// The main tracking view (prototypes/timer.html, Bar layout), or its week calendar
// (prototypes/calendar.html), which loads the current week.
export const Route = createFileRoute('/$org/timer')({
  // The view sets its own width, which the Wide page setting widens.
  staticData: { wide: true },
  loader: async ({ context }) => {
    const { queryClient, session } = context
    const organizationId = context.organization.id
    const settings = session.settings
    const zone = settings?.timeZone
    await Promise.all([
      queryClient.query({ ...runningTimerQuery, staleTime: 'static' }),
      queryClient.query({ ...projectsQuery(organizationId), staleTime: 'static' }),
      queryClient.query({
        ...firstEntryQuery(organizationId, session.user.id),
        staleTime: 'static',
      }),
      zone &&
        queryClient.query({
          ...entriesQuery(organizationId, session.user.id, recentRange(zone, RECENT_DAYS)),
          staleTime: 'static',
        }),
      settings?.timerView === 'calendar' &&
        queryClient.query({
          ...entriesQuery(
            organizationId,
            session.user.id,
            weekRange(
              localDate(Date.now(), settings.timeZone),
              settings.timeZone,
              settings.weekStart,
            ),
          ),
          staleTime: 'static',
        }),
    ])
  },
  pendingComponent: TimerPending,
  head: () => ({ meta: [{ title: `${m.nav_timer()} · ${m.app_name()}` }] }),
  component: Timer,
})

function Timer() {
  const context = Route.useRouteContext()
  return <TimerPage organizationId={context().organization.id} />
}
