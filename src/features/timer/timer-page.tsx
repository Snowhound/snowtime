import { useQuery } from '@tanstack/solid-query'
import { Show } from 'solid-js'
import { sessionQuery } from '~/lib/session'
import { TimerView } from './timer-view'

// The view needs the user's settings, which the app frame creates on first sign-in, and
// starts afresh in another organization.
export function TimerPage(props: { organizationId: string }) {
  const session = useQuery(() => sessionQuery)
  return (
    <Show when={session.data?.settings && session.data}>
      {(data) => (
        <Show when={props.organizationId} keyed>
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
