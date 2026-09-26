import { createFileRoute } from '@tanstack/solid-router'
import * as v from 'valibot'
import { ReportSearch, requestedInput } from '~/features/reports/filters'
import { reportQuery } from '~/features/reports/queries'
import { ReportsPage } from '~/features/reports/reports-page'
import { ReportsPending } from '~/features/reports/reports-pending'
import { localDate } from '~/lib/calendar'
import { membersQuery } from '~/lib/members'
import { projectsQuery } from '~/lib/projects'
import { teamsQuery } from '~/lib/teams'
import { m } from '~/paraglide/messages.js'

// Day and week totals (prototypes/reports.html, 02 · Timesheet). Bad or missing search
// params fall back to this month by project.
//
// The filters aren't loaderDeps on purpose: a filter change then keeps this match, so the
// router reloads it in the background and the view keeps the previous report on screen,
// rather than showing ReportsPending. The loader reads them from the location instead.
export const Route = createFileRoute('/$org/reports')({
  staticData: { wide: true },
  validateSearch: ReportSearch,
  loader: async ({ context, location }) => {
    const { queryClient, session } = context
    const organizationId = session.activeOrganizationId!
    const settings = session.settings
    const input =
      settings &&
      requestedInput(v.parse(ReportSearch, location.search), {
        today: localDate(Date.now(), settings.timeZone),
        weekStart: settings.weekStart,
      })
    await Promise.all([
      queryClient.ensureQueryData(projectsQuery(organizationId)),
      queryClient.ensureQueryData(teamsQuery(organizationId)),
      queryClient.ensureQueryData(membersQuery(organizationId)),
      // A refused report shows in the view, so it doesn't fail the route.
      input && queryClient.prefetchQuery(reportQuery(organizationId, input)),
    ])
  },
  pendingComponent: ReportsPending,
  head: () => ({ meta: [{ title: `${m.nav_reports()} · ${m.app_name()}` }] }),
  component: Reports,
})

function Reports() {
  const search = Route.useSearch()
  return <ReportsPage search={search()} />
}
