import { createFileRoute } from '@tanstack/solid-router'
import { ProjectsPage } from '~/features/projects/projects-page'
import { ProjectsPending } from '~/features/projects/projects-pending'
import { monthReportQuery } from '~/features/projects/queries'
import { projectsQuery } from '~/lib/projects'
import { teamsQuery } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'

// Project list and management (prototypes/projects.html).
export const Route = createFileRoute('/$org/projects')({
  loader: async ({ context }) => {
    const { queryClient, session, organization } = context
    const organizationId = organization.id
    const admin = organization.role === 'owner' || organization.role === 'admin'
    const zone = session.settings?.timeZone
    await Promise.all([
      queryClient.ensureQueryData(projectsQuery(organizationId)),
      queryClient.ensureQueryData(teamsQuery(organizationId)),
      zone &&
        queryClient.ensureQueryData(
          monthReportQuery(organizationId, zone, admin ? null : session.user.id),
        ),
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
