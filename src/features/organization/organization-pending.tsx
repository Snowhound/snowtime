import { PagePending, Skeleton, SkeletonList } from '~/components/page-pending'
import { m } from '~/paraglide/messages.js'

// The organization page while its route loads: the section tabs, then the member list.
export function OrganizationPending() {
  return (
    <PagePending title={m.nav_organization()} subtitle>
      <Skeleton class="h-9 w-80 max-w-full" />
      <SkeletonList rows={5} />
    </PagePending>
  )
}
