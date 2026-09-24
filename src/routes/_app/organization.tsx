import { createFileRoute, redirect } from '@tanstack/solid-router'
import { m } from '~/paraglide/messages.js'

// Placeholder until task 023 builds this view.
export const Route = createFileRoute('/_app/organization')({
  // Admins and owners only; the navigation hides the page from members and team leads.
  beforeLoad: ({ context }) => {
    if (context.session.role === 'member') throw redirect({ to: '/timer' })
  },
  head: () => ({ meta: [{ title: `${m.nav_organization()} · ${m.app_name()}` }] }),
  component: Organization,
})

function Organization() {
  return <h1 class="text-2xl font-semibold tracking-tight">{m.nav_organization()}</h1>
}
