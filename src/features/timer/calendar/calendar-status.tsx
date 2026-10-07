// The line under the week grid: what the last change did, with its Undo, or what went wrong;
// and the grid's key hint. While the busy server hasn't saved a change, it says so with
// "Try again" in Undo's place.
import ClockIcon from 'lucide-solid/icons/clock'
import Undo2Icon from 'lucide-solid/icons/undo-2'
import { Show } from 'solid-js'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

export interface Status {
  text: string
  error?: boolean
  undo?: () => void
}

export function CalendarStatus(props: {
  status: Status | null
  pending: boolean
  onUndo: () => void
  onRetry: () => void
}) {
  return (
    <div class="flex min-h-10 items-center justify-between gap-3 border-t px-3 py-1.5 text-sm sm:px-4">
      <Show
        when={props.pending}
        fallback={
          <p
            class={cn(
              'flex min-w-0 flex-wrap items-center gap-x-2',
              props.status?.error ? 'text-destructive' : 'text-muted-foreground',
            )}
            role="status"
          >
            <span>{props.status?.text}</span>
            <Show when={props.status?.undo}>
              <Button
                variant="link"
                size="sm"
                class="h-auto gap-1 p-0"
                onClick={() => props.onUndo()}
              >
                <Undo2Icon aria-hidden="true" />
                {m.calendar_undo()}
              </Button>
            </Show>
          </p>
        }
      >
        <p class="text-warning flex min-w-0 flex-wrap items-center gap-x-2" role="status">
          <span class="flex items-center gap-1.5">
            <ClockIcon class="size-3.5" aria-hidden="true" />
            {m.calendar_pending()}
          </span>
          <Button
            variant="link"
            size="sm"
            class="text-warning h-auto p-0"
            onClick={() => props.onRetry()}
          >
            {m.page_error_retry()}
          </Button>
        </p>
      </Show>
      <p class="text-muted-foreground hidden shrink-0 text-xs md:block">{m.calendar_hint()}</p>
    </div>
  )
}
