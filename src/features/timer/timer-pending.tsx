import { PagePending, Skeleton, SkeletonList } from '~/components/page-pending'
import { Card } from '~/components/ui/card'
import { m } from '~/paraglide/messages.js'

// The timer while its route loads: the timer bar, then a day of entries.
export function TimerPending() {
  return (
    <PagePending title={m.nav_timer()}>
      <Card class="flex items-center gap-3 p-3">
        <Skeleton class="h-9 flex-1" />
        <Skeleton class="hidden h-9 w-32 sm:block" />
        <Skeleton class="h-9 w-20" />
        <Skeleton class="size-10 rounded-full" />
      </Card>
      <div class="grid gap-2">
        <Skeleton class="h-4 w-40" />
        <SkeletonList rows={4} />
      </div>
    </PagePending>
  )
}
