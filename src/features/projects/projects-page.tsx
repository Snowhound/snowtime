import { useQuery } from '@tanstack/solid-query'
import { Show } from 'solid-js'
import { organizationIn, sessionQuery } from '~/lib/session'
import { ProjectsView } from './projects-view'

// The view reads the month in the user's zone, from the settings the app frame creates on
// first sign-in, and starts afresh in another organization.
export function ProjectsPage(props: { organizationId: string }) {
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
              <ProjectsView
                organizationId={organizationId}
                organizationName={organization()?.name ?? ''}
                userId={data().user.id}
                admin={isAdmin(organization()?.role)}
                zone={data().settings!.timeZone}
              />
            )
          }}
        </Show>
      )}
    </Show>
  )
}

function isAdmin(role: string | undefined) {
  return role === 'owner' || role === 'admin'
}
