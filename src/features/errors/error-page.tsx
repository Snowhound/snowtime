import type { ErrorComponentProps } from '@tanstack/solid-router'
import { useRouter } from '@tanstack/solid-router'
import TriangleAlertIcon from 'lucide-solid/icons/triangle-alert'
import { Show } from 'solid-js'
import { isServer } from 'solid-js/web'
import { Button } from '~/components/ui/button'
import { errorMessage } from '~/lib/errors'
import { m } from '~/paraglide/messages.js'
import { AppError } from '~/server/errors'
import { MaintenancePage } from './maintenance-page'
import { StatusPage } from './status-page'

// The name of an error that carries the message to show, and whether the database was
// unreachable; see ErrorPage.
const SHOWN_ERROR = 'ShownError'

function unavailable(error: unknown) {
  return error instanceof AppError && error.code === 'UNAVAILABLE'
}

function shownError(error: unknown) {
  return Object.assign(new Error(errorMessage(error)), {
    name: SHOWN_ERROR,
    stack: '',
    unavailable: unavailable(error),
  })
}

function isShownError(error: unknown): error is ReturnType<typeof shownError> {
  return error instanceof Error && error.name === SHOWN_ERROR
}

// An error thrown while a route loads or renders. It shows an AppError's message, and a
// generic one for anything else, so no stack or server text reaches the page. While the
// database is unreachable, it shows the maintenance page instead.
export function ErrorPage(props: ErrorComponentProps) {
  // For a loader's error, TanStack's Solid router renders this in place of the route on the
  // server but as the error boundary's fallback on the client, so hydration adds a second
  // page beside the server's. Thrown again, the error reaches Solid's boundary on the server
  // too, which renders the fallback and sends the error to the client for hydration. The
  // server's first render has no reset. Solid sends the error before Start's serialization
  // adapters load, so it goes as a plain Error with only the message to show and the
  // unavailable flag, and no stack, which Solid would otherwise send along.
  // oxlint-disable-next-line solid/reactivity -- the server renders once, so props don't change.
  if (isServer && !(props.reset as (() => void) | undefined)) throw shownError(props.error)

  const router = useRouter()
  function message() {
    const error: unknown = props.error
    return isShownError(error) ? error.message : errorMessage(error)
  }
  function maintenance() {
    const error: unknown = props.error
    return isShownError(error) ? error.unavailable : unavailable(error)
  }
  // Loading the routes again clears a loader's error; reset renders the page again after
  // an error while rendering.
  async function retry() {
    await router.invalidate()
    props.reset()
  }

  return (
    <Show when={!maintenance()} fallback={<MaintenancePage onAvailable={retry} />}>
      <StatusPage
        icon={<TriangleAlertIcon aria-hidden="true" />}
        title={m.page_error_title()}
        description={message()}
      >
        <Button onClick={retry}>{m.page_error_retry()}</Button>
      </StatusPage>
    </Show>
  )
}
