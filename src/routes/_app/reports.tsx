import { createFileRoute } from '@tanstack/solid-router'
import { m } from '~/paraglide/messages.js'

// Placeholder until task 023 builds this view.
export const Route = createFileRoute('/_app/reports')({
  head: () => ({ meta: [{ title: `${m.nav_reports()} · ${m.app_name()}` }] }),
  component: Reports,
})

function Reports() {
  return <h1 class="text-2xl font-semibold tracking-tight">{m.nav_reports()}</h1>
}
