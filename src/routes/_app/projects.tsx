import { createFileRoute } from '@tanstack/solid-router'
import { ProjectsPage } from '~/features/projects/projects-page'
import { monthReportQuery } from '~/features/projects/queries'
import { projectsQuery } from '~/lib/projects'
import { teamsQuery } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'

// Project list and management (prototypes/projects.html).
export const Route = createFileRoute('/_app/projects')({
  loader: async ({ context }) => {
    const { queryClient, session } = context
    const organizationId = session.activeOrganizationId!
    const admin = session.role === 'owner' || session.role === 'admin'
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
  head: () => ({ meta: [{ title: `${m.nav_projects()} · ${m.app_name()}` }] }),
  component: ProjectsPage,
})
