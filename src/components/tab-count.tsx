import type { Component } from 'solid-js'

// A count beside a tab's label, as a pill centred on the label rather than smaller text
// that sits high beside it.
export const TabCount: Component<{ count: number }> = (props) => (
  <span class="bg-foreground/10 ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs leading-none tabular-nums">
    {props.count}
  </span>
)
