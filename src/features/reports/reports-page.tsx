import { useQuery } from '@tanstack/solid-query'
import { Show } from 'solid-js'
import { sessionQuery } from '~/lib/session'
import type { ReportSearch } from './filters'
import { ReportsView } from './reports-view'

// Days and weeks follow the user's zone and week start, from the settings the app frame
// creates on first sign-in; the view starts afresh when the active organization changes.
export function ReportsPage(props: { search: ReportSearch }) {
  const session = useQuery(() => sessionQuery)
  return (
    <Show when={session.data?.settings && session.data}>
      {(data) => (
        <Show when={data().activeOrganizationId} keyed>
          {(organizationId) => (
            <ReportsView
              organizationId={organizationId}
              userId={data().user.id}
              admin={data().role === 'owner' || data().role === 'admin'}
              zone={data().settings!.timeZone}
              weekStart={data().settings!.weekStart}
              search={props.search}
            />
          )}
        </Show>
      )}
    </Show>
  )
}
