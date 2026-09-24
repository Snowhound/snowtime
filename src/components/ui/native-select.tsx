import type { Component, ComponentProps } from 'solid-js'
import { splitProps } from 'solid-js'

import { cn } from '~/lib/utils'

// SelectTrigger's classes and chevrons on a native <select>, as prototypes/ui.js draws
// `data-ui="select"`. For long lists such as time zones, where the browser's picker and
// type-to-find beat a listbox. Not part of the Solid-UI registry.
const NativeSelect: Component<ComponentProps<'select'>> = (props) => {
  const [local, others] = splitProps(props, ['class'])
  return (
    <div class="relative min-w-0">
      <select
        class={cn(
          'flex h-10 w-full appearance-none items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 pr-8 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          local.class,
        )}
        {...others}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-50"
      >
        <path d="M8 9l4 -4l4 4" />
        <path d="M16 15l-4 4l-4 -4" />
      </svg>
    </div>
  )
}

export { NativeSelect }
