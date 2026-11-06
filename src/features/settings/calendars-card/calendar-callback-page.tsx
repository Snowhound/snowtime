// Where the calendar provider sends the user back after its consent page: the code goes to
// the API, which stores the connection, and the app returns to where Connect was pressed.
// The redirect URL each deployment registers with the provider (docs/deployment/README.md).
import { Link, useRouter } from '@tanstack/solid-router'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import { Show, createSignal, onMount } from 'solid-js'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { buttonVariants } from '~/components/ui/button'
import { errorMessage } from '~/lib/errors'
import { m } from '~/paraglide/messages.js'
import { useFinishCalendarConnection } from './queries'

export function CalendarCallbackPage(props: { code?: string; state?: string; error?: string }) {
  const finish = useFinishCalendarConnection()
  const router = useRouter()
  const [failure, setFailure] = createSignal<string | null>(null)

  onMount(() => {
    // The provider names a refusal, such as access_denied, instead of sending a code.
    if (props.error || !props.code || !props.state) {
      setFailure(m.calendar_callback_denied())
      return
    }
    finish.mutate(
      { code: props.code, state: props.state },
      {
        onSuccess: ({ returnTo }) => router.history.replace(returnTo),
        onError: (error) => setFailure(m.calendar_callback_failed({ error: errorMessage(error) })),
      },
    )
  })

  return (
    <main class="mx-auto grid max-w-md gap-4 px-4 py-16">
      <Show
        when={failure()}
        fallback={
          <p class="text-muted-foreground flex items-center gap-2 text-sm" role="status">
            <LoaderCircleIcon class="size-4 animate-spin" aria-hidden="true" />
            {m.calendar_callback_title()}
          </p>
        }
      >
        {(text) => (
          <>
            <Alert variant="destructive" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{text()}</AlertDescription>
            </Alert>
            <Link to="/" class={buttonVariants({ variant: 'outline' })}>
              {m.calendar_callback_back()}
            </Link>
          </>
        )}
      </Show>
    </main>
  )
}
