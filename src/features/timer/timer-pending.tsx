import { useQuery } from '@tanstack/solid-query'
import { Show } from 'solid-js'
import { PagePending, Skeleton, SkeletonList } from '~/components/page-pending'
import { Card } from '~/components/ui/card'
import { sessionQuery } from '~/lib/queries/session'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

// The timer while its route loads: the timer bar, then a day of entries or the calendar, as
// wide as the view.
export function TimerPending() {
  const session = useQuery(() => sessionQuery)
  return (
    <div
      class={cn(
        'mx-auto w-full',
        session.data?.settings?.wideTimer ? 'max-w-[88rem]' : 'max-w-6xl',
      )}
    >
      <PagePending title={m.nav_timer()}>
        <Card class="flex items-center gap-3 p-3">
          <Skeleton class="h-9 flex-1" />
          <Skeleton class="hidden h-9 w-32 sm:block" />
          <Skeleton class="h-9 w-20" />
          <Skeleton class="size-10 rounded-full" />
        </Card>
        <Show
          when={session.data?.settings?.timerView !== 'calendar'}
          fallback={<Skeleton class="h-[max(24rem,min(40rem,calc(100dvh-17rem)))] rounded-lg" />}
        >
          <div class="grid gap-2">
            <Skeleton class="h-4 w-40" />
            <SkeletonList rows={4} />
          </div>
        </Show>
      </PagePending>
    </div>
  )
}
