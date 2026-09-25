import { useQuery } from '@tanstack/solid-query'
import { useNavigate } from '@tanstack/solid-router'
import { Show, createSignal, onMount } from 'solid-js'
import { PageTitle } from '~/components/page-title'
import { buttonVariants } from '~/components/ui/button'
import { sessionQuery } from '~/lib/session'
import { signInMethodsQuery } from '~/lib/sign-in-methods'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { PreferencesCard } from './preferences-card'
import { ProfileCard } from './profile-card'
import { linkErrorMessage } from './sign-in-methods-list'

// Preferences come first because they change most often; Profile holds the name and
// the sign-in methods (prototypes/settings.html).
export function SettingsPage(props: { initialError?: string }) {
  const session = useQuery(() => sessionQuery)
  const methods = useQuery(() => signInMethodsQuery)
  const navigate = useNavigate()

  // A failed link comes back with ?error=; the message stays, the parameter goes, so a
  // reload doesn't show it again.
  const [linkError] = createSignal(props.initialError ? linkErrorMessage(props.initialError) : null)
  onMount(() => {
    if (!props.initialError) return
    void navigate({ to: '/settings', search: {}, replace: true, hash: 'sign-in-methods' })
    document.getElementById('sign-in-methods')?.scrollIntoView()
  })

  // The tagline centers on the cards, not the section links beside them.
  const [cards, setCards] = createSignal<HTMLDivElement>()

  return (
    <div class="relative grid gap-4">
      <PageTitle title={m.nav_settings()} centerOn={cards} />
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
            <div ref={setCards} class="flex max-w-3xl min-w-0 flex-col gap-6">
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
