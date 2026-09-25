import { For } from 'solid-js'
import { PagePending, Skeleton, SkeletonList } from '~/components/page-pending'
import { m } from '~/paraglide/messages.js'

// Reports while its route loads: the filter bar and the timesheet, at the width the view
// gives them on the wide page.
export function ReportsPending() {
  return (
    <div class="mx-auto w-full max-w-[68rem]">
      <PagePending title={m.nav_reports()} subtitle>
        <div class="flex flex-wrap items-end gap-4">
          <For each={['w-36', 'w-24', 'w-72', 'w-40', 'w-56', 'w-28']}>
            {(width) => <Skeleton class={`h-9 ${width}`} />}
          </For>
        </div>
        <SkeletonList rows={6} />
      </PagePending>
    </div>
  )
}
