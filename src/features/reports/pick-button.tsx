// Names and totals in every view that narrow the Entries card to their row, day or week, or
// both. Pressed while the card shows that part; choosing it again shows all entries.
import type { JSX } from 'solid-js'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

export const PICK_CLASS =
  'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 -mx-1.5 -my-0.5 rounded-sm px-1.5 py-0.5 focus-visible:ring-2 focus-visible:outline-none'

// The hint every pick button points to, once per view.
export function PickHint(props: { id: string }) {
  return (
    <span id={props.id} class="sr-only">
      {m.reports_entries_pick_hint()}
    </span>
  )
}

export function PickButton(props: {
  pressed: boolean
  hint: string
  class?: string
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      aria-describedby={props.hint}
      class={cn(PICK_CLASS, props.class)}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  )
}
