import { createFileRoute } from '@tanstack/solid-router'
import { m } from '../../paraglide/messages.js'

// Placeholder until task 023 builds this view.
export const Route = createFileRoute('/_app/projects')({
  head: () => ({ meta: [{ title: `${m.nav_projects()} · ${m.app_name()}` }] }),
  component: Projects,
})

function Projects() {
  return <h1 class="text-2xl font-semibold tracking-tight">{m.nav_projects()}</h1>
}
