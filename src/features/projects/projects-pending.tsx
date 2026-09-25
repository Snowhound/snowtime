import { PagePending, Skeleton, SkeletonList } from '~/components/page-pending'
import { m } from '~/paraglide/messages.js'

// Projects while its route loads: the status tabs and search, then the project list.
export function ProjectsPending() {
  return (
    <PagePending title={m.nav_projects()} subtitle>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton class="h-9 w-64" />
        <Skeleton class="h-9 w-full sm:w-64" />
      </div>
      <SkeletonList rows={5} />
    </PagePending>
  )
}
