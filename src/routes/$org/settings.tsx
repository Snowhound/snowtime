import { createFileRoute } from '@tanstack/solid-router'
import * as v from 'valibot'
import { apiKeysQuery } from '~/features/settings/api-keys-card/queries'
import { SettingsPage } from '~/features/settings/settings-page'
import { SettingsPending } from '~/features/settings/settings-pending'
import { signInMethodsQuery } from '~/lib/queries/sign-in-methods'
import { m } from '~/paraglide/messages.js'

export const Route = createFileRoute('/$org/settings')({
  // `error` is set by Better Auth when linking a provider fails.
  validateSearch: v.object({ error: v.optional(v.string()) }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.query({ ...signInMethodsQuery, staleTime: 'static' }),
      context.queryClient.query(apiKeysQuery),
    ]),
  pendingComponent: SettingsPending,
  head: () => ({ meta: [{ title: `${m.nav_settings()} · ${m.app_name()}` }] }),
  component: Settings,
})

function Settings() {
  const search = Route.useSearch()
  return <SettingsPage initialError={search().error} />
}
