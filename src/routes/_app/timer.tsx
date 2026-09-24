import { createFileRoute } from '@tanstack/solid-router'
import { m } from '../../paraglide/messages.js'

// Placeholder until task 023 builds this view.
export const Route = createFileRoute('/_app/timer')({
  head: () => ({ meta: [{ title: `${m.nav_timer()} · ${m.app_name()}` }] }),
  component: Timer,
})

function Timer() {
  return <h1 class="text-2xl font-semibold tracking-tight">{m.nav_timer()}</h1>
}
