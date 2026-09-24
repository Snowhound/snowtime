import { useQueryClient } from '@tanstack/solid-query'
import { Outlet, createFileRoute, redirect } from '@tanstack/solid-router'
import { onMount } from 'solid-js'
import { AppHeader } from '../components/app-header'
import { getSettings } from '../functions/settings'
import { sessionQuery } from '../lib/session'
import { getLocale } from '../paraglide/runtime.js'

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
  const queryClient = useQueryClient()
  const context = Route.useRouteContext()

  // The first getSettings call creates the user's settings from the browser's time zone
  // and language (docs/architecture.md, "User settings"); the server can't know the zone.
  onMount(async () => {
    if (context().session.settings) return
    await getSettings({
      data: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: getLocale() },
    })
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey })
  })

  return (
    <div class="flex min-h-dvh flex-col">
      <AppHeader />
      <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8">
        <Outlet />
      </main>
    </div>
  )
}
