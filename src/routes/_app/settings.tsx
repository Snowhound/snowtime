import { createFileRoute } from '@tanstack/solid-router'
import * as v from 'valibot'
import { SettingsPage } from '~/features/settings/settings-page'
import { signInMethodsQuery } from '~/lib/sign-in-methods'
import { m } from '~/paraglide/messages.js'

export const Route = createFileRoute('/_app/settings')({
  // `error` is set by Better Auth when linking a provider fails.
  validateSearch: v.object({ error: v.optional(v.string()) }),
  loader: ({ context }) => context.queryClient.ensureQueryData(signInMethodsQuery),
  head: () => ({ meta: [{ title: `${m.nav_settings()} · ${m.app_name()}` }] }),
  component: Settings,
})

function Settings() {
  const search = Route.useSearch()
  return <SettingsPage initialError={search().error} />
}
