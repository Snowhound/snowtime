import { PagePending, Skeleton } from '~/components/page-pending'
import { Card } from '~/components/ui/card'
import { m } from '~/paraglide/messages.js'

// Settings while its route loads: the section links beside the preferences card.
export function SettingsPending() {
  return (
    <PagePending title={m.nav_settings()}>
      <div class="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <div class="hidden flex-col gap-2 lg:flex">
          <Skeleton class="h-9" />
          <Skeleton class="h-9" />
        </div>
        <Card class="grid max-w-3xl gap-5 p-6">
          <Skeleton class="h-5 w-40" />
          <Skeleton class="h-9" />
          <Skeleton class="h-9" />
          <Skeleton class="h-9" />
        </Card>
      </div>
    </PagePending>
  )
}
