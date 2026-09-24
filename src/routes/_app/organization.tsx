import { createFileRoute } from '@tanstack/solid-router'
import { OrganizationPage } from '~/features/organization/organization-page'
import { appUrlQuery } from '~/features/organization/queries'
import { OrganizationSearch } from '~/features/organization/search'
import { membersQuery } from '~/lib/members'
import { projectsQuery } from '~/lib/projects'
import { teamsQuery } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'

// Members, invitations, teams, and the organization's name (prototypes/organization.html).
// Admins and owners only: members and team leads get a no-access message, and the
// navigation hides the page from them.
export const Route = createFileRoute('/_app/organization')({
  validateSearch: OrganizationSearch,
  loader: async ({ context }) => {
    const { queryClient, session } = context
    if (session.role !== 'owner' && session.role !== 'admin') return
    const organizationId = session.activeOrganizationId!
    await Promise.all([
      queryClient.ensureQueryData(membersQuery(organizationId)),
      queryClient.ensureQueryData(teamsQuery(organizationId)),
      queryClient.ensureQueryData(projectsQuery(organizationId)),
      queryClient.ensureQueryData(appUrlQuery),
    ])
  },
  head: () => ({ meta: [{ title: `${m.nav_organization()} · ${m.app_name()}` }] }),
  component: Organization,
})

function Organization() {
  const search = Route.useSearch()
  return <OrganizationPage tab={search().tab ?? 'members'} />
}
