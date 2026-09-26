import { useQuery } from '@tanstack/solid-query'
import { Show } from 'solid-js'
import { organizationIn, sessionQuery } from '~/lib/session'
import type { ReportSearch } from './filters'
import { ReportsView } from './reports-view'

// Days and weeks follow the user's zone and week start, from the settings the app frame
// creates on first sign-in; the view starts afresh in another organization.
export function ReportsPage(props: { organizationId: string; search: ReportSearch }) {
  const session = useQuery(() => sessionQuery)
  return (
    <Show when={session.data?.settings && session.data}>
      {(data) => (
        <Show when={props.organizationId} keyed>
          {(organizationId) => {
            function organization() {
              return organizationIn(data(), organizationId)
            }
            return (
              <ReportsView
                organizationId={organizationId}
                organizationSlug={organization()?.slug ?? 'snowtime'}
                userId={data().user.id}
                admin={organization()?.role === 'owner' || organization()?.role === 'admin'}
                zone={data().settings!.timeZone}
                weekStart={data().settings!.weekStart}
                search={props.search}
              />
            )
          }}
        </Show>
      )}
    </Show>
  )
}
