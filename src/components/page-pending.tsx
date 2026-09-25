// A signed-in page while its route loads, as the route's pendingComponent (src/router.tsx):
// the page's real title at once, and pulsing shapes where its content will be, so a link
// opens without waiting for the server. Each feature lays out its own shapes as children.
import { For, type ParentProps, Show } from 'solid-js'
import { Card } from '~/components/ui/card'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { PageTitle } from './page-title'

// One pulsing shape. Decorative: PagePending tells screen readers the page is loading.
export function Skeleton(props: { class?: string }) {
  return (
    <div aria-hidden="true" class={cn('bg-foreground/10 animate-pulse rounded-md', props.class)} />
  )
}

// A card of list rows, the shape of most pages' main content.
export function SkeletonList(props: { rows: number; class?: string }) {
  return (
    <Card class={cn('divide-y overflow-hidden', props.class)}>
      <For each={Array.from({ length: props.rows })}>
        {() => (
          <div class="flex items-center gap-4 px-4 py-3.5">
            <Skeleton class="size-3 shrink-0 rounded-full" />
            <Skeleton class="h-4 max-w-72 flex-1" />
            <Skeleton class="ml-auto h-4 w-14 shrink-0" />
          </div>
        )}
      </For>
    </Card>
  )
}

export function PagePending(props: ParentProps<{ title: string; subtitle?: boolean }>) {
  return (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4" aria-busy="true">
      <div class="relative flex min-w-0 flex-col gap-1">
        <PageTitle title={props.title} />
        <Show when={props.subtitle}>
          <Skeleton class="my-0.5 h-4 w-72 max-w-full" />
        </Show>
      </div>
      <p class="sr-only" role="status">
        {m.page_loading()}
      </p>
      {props.children}
    </div>
  )
}
