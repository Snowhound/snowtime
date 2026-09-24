import { useQuery, useQueryClient } from '@tanstack/solid-query'
import { type ParentProps, onMount } from 'solid-js'
import { SceneLayer } from '~/components/scene-layer'
import { SCENE_DEFAULTS, sceneAttributes } from '~/lib/scene'
import { sessionQuery } from '~/lib/session'
import { getLocale } from '~/paraglide/runtime.js'
import type { AppSession } from '~/server/auth/auth.functions'
import { getSettings } from '~/server/settings/settings.functions'
import { AppHeader } from './app-header'

export function AppFrame(props: ParentProps<{ session: AppSession }>) {
  const queryClient = useQueryClient()
  const session = useQuery(() => sessionQuery)
  // The session query, not the route's copy, so a saved setting shows at once.
  function scene() {
    return session.data?.settings ?? SCENE_DEFAULTS
  }

  // The first getSettings call creates the user's settings from the browser's time zone
  // and language (docs/architecture.md, "User settings"); the server can't know the zone.
  onMount(async () => {
    if (props.session.settings) return
    await getSettings({
      data: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: getLocale() },
    })
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey })
  })

  return (
    <div class="isolate flex min-h-dvh flex-col" {...sceneAttributes(scene())}>
      <SceneLayer settings={scene()} />
      <AppHeader />
      <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8">{props.children}</main>
    </div>
  )
}
