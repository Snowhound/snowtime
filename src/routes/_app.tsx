import { Outlet, createFileRoute, redirect } from '@tanstack/solid-router'
import { AppFrame } from '~/features/app-frame/app-frame'

// The signed-in layout. Signed-out users go to sign-in and come back to the page they
// asked for; users without an organization go to their invitation or create one.
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    const { session } = context
    if (!session) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    if (!session.activeOrganizationId) {
      if (session.invitationId) {
        throw redirect({ to: '/invitation/$id', params: { id: session.invitationId } })
      }
      throw redirect({ to: '/create-organization' })
    }
    return { session }
  },
  component: AppLayout,
})

function AppLayout() {
  const context = Route.useRouteContext()
  return (
    <AppFrame session={context().session}>
      <Outlet />
    </AppFrame>
  )
}
