import ClockIcon from 'lucide-solid/icons/clock'
import { Show } from 'solid-js'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { usePendingChanges } from '~/lib/queries/refusal'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

// Changes the server refused while busy. They stay on screen, and "Try again" sends them in
// the order they were made. The icon sits centered in the row rather than pinned top left.
export function PendingChanges(props: { class?: string }) {
  const pending = usePendingChanges()
  return (
    <Show when={pending.count() > 0}>
      <Alert
        variant="warning"
        class={cn(
          'mb-4 flex items-center gap-3 py-3 [&>svg]:static [&>svg]:shrink-0 [&>svg+div]:translate-y-0 [&>svg~*]:pl-0',
          props.class,
        )}
      >
        <ClockIcon aria-hidden="true" />
        <AlertDescription class="flex flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span role="status">{m.change_pending()}</span>
          <Button
            variant="outline"
            size="sm"
            class="border-warning/50 text-warning hover:bg-warning/10 hover:text-warning"
            disabled={pending.retrying()}
            onClick={() => pending.retry()}
          >
            {m.page_error_retry()}
          </Button>
        </AlertDescription>
      </Alert>
    </Show>
  )
}
