import { Outlet, createFileRoute, notFound, redirect } from '@tanstack/solid-router'
import { AppFrame } from '~/components/app-frame/app-frame'
import { SLUG_PATTERN } from '~/lib/app-paths'
import { organizationOfPath } from '~/lib/session'

// The signed-in layout, under the organization's slug: each tab shows the organization in its
// URL (docs/architecture.md, "Tenancy"). Signed-out users go to sign-in and come back to the
// page they asked for; users without an organization go to their invitation or create one.
// A first segment that can't be a slug, such as favicon.ico, is not found.
export const Route = createFileRoute('/$org')({
  beforeLoad: ({ context, location, params }) => {
    if (!SLUG_PATTERN.test(params.org)) throw notFound()
    const { session } = context
    if (!session) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    return { session, organization: organizationOfPath(session, params.org, location.href) }
  },
  component: AppLayout,
})

function AppLayout() {
  const context = Route.useRouteContext()
  return (
    <AppFrame session={context().session} organizationId={context().organization.id}>
      <Outlet />
    </AppFrame>
  )
}
