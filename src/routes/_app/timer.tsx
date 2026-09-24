import { createFileRoute } from '@tanstack/solid-router'
import { recentRange } from '~/features/timer/entries'
import { entriesQuery, projectsQuery, runningTimerQuery } from '~/features/timer/queries'
import { TimerPage } from '~/features/timer/timer-page'
import { RECENT_DAYS } from '~/features/timer/timer-view'
import { m } from '~/paraglide/messages.js'

// The main tracking view (prototypes/timer.html, Bar layout).
export const Route = createFileRoute('/_app/timer')({
  loader: async ({ context }) => {
    const { queryClient, session } = context
    const organizationId = session.activeOrganizationId!
    const zone = session.settings?.timeZone
    await Promise.all([
      queryClient.ensureQueryData(runningTimerQuery),
      queryClient.ensureQueryData(projectsQuery(organizationId)),
      zone &&
        queryClient.ensureQueryData(
          entriesQuery(organizationId, session.user.id, recentRange(zone, RECENT_DAYS)),
        ),
    ])
  },
  head: () => ({ meta: [{ title: `${m.nav_timer()} · ${m.app_name()}` }] }),
  component: TimerPage,
})
