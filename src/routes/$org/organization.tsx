import { createFileRoute } from '@tanstack/solid-router'
import { OrganizationPage } from '~/features/organization/organization-page'
import { OrganizationPending } from '~/features/organization/organization-pending'
import { appUrlQuery } from '~/features/organization/queries'
import { OrganizationSearch } from '~/features/organization/search'
import { membersQuery } from '~/lib/members'
import { projectsQuery } from '~/lib/projects'
import { teamsQuery } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'

// Members, invitations, teams, and the organization's name (prototypes/organization.html).
// Admins and owners only: members and team leads get a no-access message, and the
// navigation hides the page from them.
export const Route = createFileRoute('/$org/organization')({
  validateSearch: OrganizationSearch,
  loader: async ({ context }) => {
    const { queryClient, organization } = context
    if (organization.role !== 'owner' && organization.role !== 'admin') return
    const organizationId = organization.id
    await Promise.all([
      queryClient.ensureQueryData(membersQuery(organizationId)),
      queryClient.ensureQueryData(teamsQuery(organizationId)),
      queryClient.ensureQueryData(projectsQuery(organizationId)),
      queryClient.ensureQueryData(appUrlQuery),
    ])
  },
  pendingComponent: OrganizationPending,
  head: () => ({ meta: [{ title: `${m.nav_organization()} · ${m.app_name()}` }] }),
  component: Organization,
})

function Organization() {
  const context = Route.useRouteContext()
  const search = Route.useSearch()
  return (
    <OrganizationPage organizationId={context().organization.id} tab={search().tab ?? 'members'} />
  )
}
