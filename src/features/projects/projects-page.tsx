import { useQuery } from '@tanstack/solid-query'
import { Show } from 'solid-js'
import { sessionQuery } from '~/lib/session'
import { ProjectsView } from './projects-view'

// The view reads the month in the user's zone, from the settings the app frame creates on
// first sign-in, and starts afresh when the active organization changes.
export function ProjectsPage() {
  const session = useQuery(() => sessionQuery)
  return (
    <Show when={session.data?.settings && session.data}>
      {(data) => (
        <Show when={data().activeOrganizationId} keyed>
          {(organizationId) => (
            <ProjectsView
              organizationId={organizationId}
              organizationName={
                data().organizations.find((o) => o.id === organizationId)?.name ?? ''
              }
              userId={data().user.id}
              admin={isAdmin(data().role)}
              zone={data().settings!.timeZone}
            />
          )}
        </Show>
      )}
    </Show>
  )
}

function isAdmin(role: string | null) {
  return role === 'owner' || role === 'admin'
}
