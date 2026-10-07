import { useQueryClient } from '@tanstack/solid-query'
import ClockIcon from 'lucide-solid/icons/clock'
import { For, createSignal, onCleanup } from 'solid-js'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { pendingChanges, subscribePending } from '~/lib/queries/refusal'
import { m } from '~/paraglide/messages.js'

export function PendingChanges() {
  const client = useQueryClient()
  const [changes, setChanges] = createSignal(pendingChanges(client))
  onCleanup(subscribePending(client, () => setChanges(pendingChanges(client))))
  return (
    <For each={changes()}>
      {(change) => (
        <Alert class="mb-4">
          <ClockIcon aria-hidden="true" />
          <AlertDescription class="flex items-center justify-between gap-3">
            <span role="status">{m.change_pending()}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={change.retrying}
              onClick={() => void change.retry()}
            >
              {m.page_error_retry()}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </For>
  )
}
