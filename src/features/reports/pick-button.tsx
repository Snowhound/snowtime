// Names and totals in every view that narrow the Entries card to their row, day or week, or
// both. Pressed while the card shows that part; choosing it again shows all entries. They look
// as the `pick` class in src/styles.css styles them.
import type { JSX } from 'solid-js'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

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
      class={cn('pick', props.class)}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  )
}
