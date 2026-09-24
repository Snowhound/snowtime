import { useQuery } from '@tanstack/solid-query'
import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { Show, createSignal, onMount } from 'solid-js'
import * as v from 'valibot'
import { PreferencesCard } from '~/components/settings/preferences-card'
import { ProfileCard } from '~/components/settings/profile-card'
import { linkErrorMessage } from '~/components/settings/sign-in-methods-list'
import { buttonVariants } from '~/components/ui/button'
import { sessionQuery } from '~/lib/session'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { signInMethodsQuery } from '~/routes/sign-in'

// Preferences come first because they change most often; Profile holds the name and
// the sign-in methods (prototypes/settings.html).
export const Route = createFileRoute('/_app/settings')({
  // `error` is set by Better Auth when linking a provider fails.
  validateSearch: v.object({ error: v.optional(v.string()) }),
  loader: ({ context }) => context.queryClient.ensureQueryData(signInMethodsQuery),
  head: () => ({ meta: [{ title: `${m.nav_settings()} · ${m.app_name()}` }] }),
  component: Settings,
})

function Settings() {
  const session = useQuery(() => sessionQuery)
  const methods = useQuery(() => signInMethodsQuery)
  const search = Route.useSearch()
  const navigate = useNavigate()

  // A failed link comes back with ?error=; the message stays, the parameter goes, so a
  // reload doesn't show it again.
  const [linkError] = createSignal(search().error ? linkErrorMessage(search().error!) : null)
  onMount(() => {
    if (!search().error) return
    void navigate({ to: '/settings', search: {}, replace: true, hash: 'sign-in-methods' })
    document.getElementById('sign-in-methods')?.scrollIntoView()
  })

  return (
    <div class="grid gap-4">
      <h1 class="text-2xl font-semibold tracking-tight">{m.nav_settings()}</h1>
      <div class="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav class="hidden lg:block" aria-label={m.settings_sections()}>
          <ul class="sticky top-6 flex flex-col gap-1">
            <li>
              <a
                href="#preferences"
                class={cn(buttonVariants({ variant: 'ghost' }), 'w-full justify-start')}
              >
                {m.settings_preferences()}
              </a>
            </li>
            <li>
              <a
                href="#profile"
                class={cn(buttonVariants({ variant: 'ghost' }), 'w-full justify-start')}
              >
                {m.settings_profile()}
              </a>
            </li>
          </ul>
        </nav>
        <Show when={session.data}>
          {(data) => (
            <div class="flex max-w-3xl min-w-0 flex-col gap-6">
              <Show when={data().settings}>
                {(settings) => <PreferencesCard settings={settings()} />}
              </Show>
              <ProfileCard
                user={data().user}
                timeZone={data().settings?.timeZone ?? 'UTC'}
                methods={methods.data ?? []}
                linkError={linkError()}
              />
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
