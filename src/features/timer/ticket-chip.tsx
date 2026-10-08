// An entry's ticket key as a chip (prototypes/timer.html, "Ticket keys"). With the
// organization's Issue links setting, the key links to the issue in a new tab. The × turns
// the key back into text.
import XIcon from 'lucide-solid/icons/x'
import { Show } from 'solid-js'
import type { JSX } from 'solid-js'
import { Badge } from '~/components/ui/badge'
import { issueUrl } from '~/lib/tickets'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

// A row's × stays visible and brightens on hover and focus without changing the chip's width.
const ROW_REMOVE =
  'sm:opacity-50 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'

export function TicketChip(props: {
  ticket: string
  issueLinks: string | null
  // In a row: the × is muted until hover or focus.
  // `inline` at the end of the description cell, where the chip takes at most 60% of it.
  row?: boolean
  inline?: boolean
  // Without it, as for a timer running in another organization, the chip has no ×.
  onRemove?: () => void
  class?: string
}) {
  function href() {
    return issueUrl(props.issueLinks, props.ticket)
  }
  return (
    <Badge
      variant="secondary"
      class={cn(
        'h-6 min-w-0 shrink-0 gap-0.5 pr-0.5 pl-1.5 tabular-nums',
        props.inline ? 'max-w-[60%]' : 'max-w-full',
        !props.onRemove && 'pr-1.5',
        props.class,
      )}
    >
      <Show
        when={href()}
        fallback={
          <span class="min-w-0 truncate" title={props.ticket}>
            {props.ticket}
          </span>
        }
      >
        {(url) => (
          <a
            href={url()}
            target="_blank"
            rel="noopener noreferrer"
            title={m.ticket_open({ ticket: props.ticket })}
            class="decoration-foreground/30 hover:decoration-foreground focus-visible:ring-ring min-w-0 truncate rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
          >
            {props.ticket}
          </a>
        )}
      </Show>
      <Show when={props.onRemove}>
        {(remove) => (
          <button
            type="button"
            class={cn(
              'text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-ring inline-flex size-5 shrink-0 items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:outline-none',
              props.row && ROW_REMOVE,
            )}
            aria-label={m.ticket_untick({ ticket: props.ticket })}
            title={m.ticket_untick_title()}
            // Keeps focus in a description field, so its blur doesn't commit before the ×.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => remove()()}
          >
            <XIcon class="size-3" aria-hidden="true" />
          </button>
        )}
      </Show>
    </Badge>
  )
}

// The ticket in a suggestion or a Continue recent chip: a label only.
export function TicketLabel(props: { children: JSX.Element }) {
  return (
    <Badge variant="secondary" class="h-5 shrink-0 px-1.5 font-medium tabular-nums">
      {props.children}
    </Badge>
  )
}
