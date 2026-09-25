import type { ErrorComponentProps } from '@tanstack/solid-router'
import { useRouter } from '@tanstack/solid-router'
import TriangleAlertIcon from 'lucide-solid/icons/triangle-alert'
import { isServer } from 'solid-js/web'
import { Button } from '~/components/ui/button'
import { errorMessage } from '~/lib/errors'
import { m } from '~/paraglide/messages.js'
import { StatusPage } from './status-page'

// The name of an error that carries the message to show; see ErrorPage.
const SHOWN_ERROR = 'ShownError'

function shownError(error: unknown) {
  return Object.assign(new Error(errorMessage(error)), { name: SHOWN_ERROR, stack: '' })
}

// An error thrown while a route loads or renders. It shows an AppError's message, and a
// generic one for anything else, so no stack or server text reaches the page.
export function ErrorPage(props: ErrorComponentProps) {
  // For a loader's error, TanStack's Solid router renders this in place of the route on the
  // server but as the error boundary's fallback on the client, so hydration adds a second
  // page beside the server's. Thrown again, the error reaches Solid's boundary on the server
  // too, which renders the fallback and sends the error to the client for hydration. The
  // server's first render has no reset. Solid sends the error before Start's serialization
  // adapters load, so it goes as a plain Error with only the message to show, and no stack,
  // which Solid would otherwise send along.
  // oxlint-disable-next-line solid/reactivity -- the server renders once, so props don't change.
  if (isServer && !(props.reset as (() => void) | undefined)) throw shownError(props.error)

  const router = useRouter()
  function message() {
    const error: unknown = props.error
    return error instanceof Error && error.name === SHOWN_ERROR
      ? error.message
      : errorMessage(error)
  }
  // Loading the routes again clears a loader's error; reset renders the page again after
  // an error while rendering.
  async function retry() {
    await router.invalidate()
    props.reset()
  }

  return (
    <StatusPage
      icon={<TriangleAlertIcon aria-hidden="true" />}
      title={m.page_error_title()}
      description={message()}
    >
      <Button onClick={retry}>{m.page_error_retry()}</Button>
    </StatusPage>
  )
}
