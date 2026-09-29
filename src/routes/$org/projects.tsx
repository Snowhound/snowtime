import { createFileRoute } from '@tanstack/solid-router'
import { ProjectsPage } from '~/features/projects/projects-page'
import { ProjectsPending } from '~/features/projects/projects-pending'
import { monthReportQuery } from '~/features/projects/queries'
import { projectsQuery } from '~/lib/queries/projects'
import { isAdmin } from '~/lib/queries/session'
import { teamsQuery } from '~/lib/queries/teams'
import { m } from '~/paraglide/messages.js'

// Project list and management (prototypes/projects.html).
export const Route = createFileRoute('/$org/projects')({
  loader: async ({ context }) => {
    const { queryClient, session, organization } = context
    const organizationId = organization.id
    const admin = isAdmin(organization.role)
    const zone = session.settings?.timeZone
    await Promise.all([
      queryClient.query({ ...projectsQuery(organizationId), staleTime: 'static' }),
      queryClient.query({ ...teamsQuery(organizationId), staleTime: 'static' }),
      zone &&
        queryClient.query({
          ...monthReportQuery(organizationId, zone, admin ? null : session.user.id),
          staleTime: 'static',
        }),
    ])
  },
  pendingComponent: ProjectsPending,
  head: () => ({ meta: [{ title: `${m.nav_projects()} · ${m.app_name()}` }] }),
  component: Projects,
})

function Projects() {
  const context = Route.useRouteContext()
  return <ProjectsPage organizationId={context().organization.id} />
}
