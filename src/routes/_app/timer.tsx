import { createFileRoute } from '@tanstack/solid-router'
import { RECENT_DAYS, recentRange } from '~/features/timer/entries'
import { entriesQuery, firstEntryQuery, runningTimerQuery } from '~/features/timer/queries'
import { TimerPage } from '~/features/timer/timer-page'
import { TimerPending } from '~/features/timer/timer-pending'
import { projectsQuery } from '~/lib/projects'
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
      queryClient.ensureQueryData(firstEntryQuery(organizationId, session.user.id)),
      zone &&
        queryClient.ensureQueryData(
          entriesQuery(organizationId, session.user.id, recentRange(zone, RECENT_DAYS)),
        ),
    ])
  },
  pendingComponent: TimerPending,
  head: () => ({ meta: [{ title: `${m.nav_timer()} · ${m.app_name()}` }] }),
  component: TimerPage,
})
