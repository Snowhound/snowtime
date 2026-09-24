import { useQuery } from '@tanstack/solid-query'
import { createFileRoute } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { RECENT_DAYS, TimerView } from '../../components/timer/timer-view'
import { recentRange } from '../../lib/entries'
import { sessionQuery } from '../../lib/session'
import { entriesQuery, projectsQuery, runningTimerQuery } from '../../lib/timer'
import { m } from '../../paraglide/messages.js'

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
  component: Timer,
})

function Timer() {
  const session = useQuery(() => sessionQuery)
  return (
    <Show when={session.data?.settings && session.data}>
      {(data) => (
        <Show when={data().activeOrganizationId} keyed>
          {(organizationId) => (
            <TimerView
              organizationId={organizationId}
              userId={data().user.id}
              zone={data().settings!.timeZone}
              organizations={data().organizations}
            />
          )}
        </Show>
      )}
    </Show>
  )
}
