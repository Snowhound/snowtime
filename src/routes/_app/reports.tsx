import { createFileRoute } from '@tanstack/solid-router'
import { reportFilters, ReportSearch } from '~/features/reports/filters'
import { reportQuery } from '~/features/reports/queries'
import { ReportsPage } from '~/features/reports/reports-page'
import { localDate } from '~/lib/calendar'
import { membersQuery } from '~/lib/members'
import { projectsQuery } from '~/lib/projects'
import { teamsQuery } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'

// Day and week totals (prototypes/reports.html, 02 · Timesheet). Bad or missing search
// params fall back to this week by project.
export const Route = createFileRoute('/_app/reports')({
  validateSearch: ReportSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const { queryClient, session } = context
    const organizationId = session.activeOrganizationId!
    const [, teams, members] = await Promise.all([
      queryClient.ensureQueryData(projectsQuery(organizationId)),
      queryClient.ensureQueryData(teamsQuery(organizationId)),
      queryClient.ensureQueryData(membersQuery(organizationId)),
    ])
    const settings = session.settings
    if (!settings) return
    const filters = reportFilters(deps, {
      today: localDate(Date.now(), settings.timeZone),
      weekStart: settings.weekStart,
      userId: session.user.id,
      admin: session.role === 'owner' || session.role === 'admin',
      teams,
      members,
    })
    // A refused report shows in the view, so it doesn't fail the route.
    await queryClient.prefetchQuery(reportQuery(organizationId, filters.input))
  },
  head: () => ({ meta: [{ title: `${m.nav_reports()} · ${m.app_name()}` }] }),
  component: Reports,
})

function Reports() {
  const search = Route.useSearch()
  return <ReportsPage search={search()} />
}
