import { useQuery } from '@tanstack/solid-query'
import { Show } from 'solid-js'
import { sessionQuery } from '~/lib/session'
import { TimerView } from './timer-view'

// The view needs the user's settings, which the app frame creates on first sign-in, and
// starts afresh when the active organization changes.
export function TimerPage() {
  const session = useQuery(() => sessionQuery)
  return (
    <Show when={session.data?.settings && session.data}>
      {(data) => (
        <Show when={data().activeOrganizationId} keyed>
          {(organizationId) => (
            <TimerView
              organizationId={organizationId}
              userId={data().user.id}
              settings={data().settings!}
              organizations={data().organizations}
            />
          )}
        </Show>
      )}
    </Show>
  )
}
