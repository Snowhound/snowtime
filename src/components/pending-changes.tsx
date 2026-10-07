import { useQueryClient } from '@tanstack/solid-query'
import ClockIcon from 'lucide-solid/icons/clock'
import { Show, createSignal, onCleanup } from 'solid-js'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { isRetrying, pendingCount, retryPending, subscribePending } from '~/lib/queries/refusal'
import { m } from '~/paraglide/messages.js'

// Changes the server refused while busy. They stay on screen, and "Try again" sends them in
// the order they were made.
export function PendingChanges() {
  const client = useQueryClient()
  const [count, setCount] = createSignal(pendingCount(client))
  const [retrying, setRetrying] = createSignal(isRetrying(client))
  onCleanup(
    subscribePending(client, () => {
      setCount(pendingCount(client))
      setRetrying(isRetrying(client))
    }),
  )
  return (
    <Show when={count() > 0}>
      <Alert class="mb-4">
        <ClockIcon aria-hidden="true" />
        <AlertDescription class="flex items-center justify-between gap-3">
          <span role="status">{m.change_pending()}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={retrying()}
            onClick={() => void retryPending(client)}
          >
            {m.page_error_retry()}
          </Button>
        </AlertDescription>
      </Alert>
    </Show>
  )
}
